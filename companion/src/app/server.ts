import Fastify, { type FastifyInstance } from 'fastify';
import { readFile, writeFile, mkdir, readdir, stat, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { capabilitySchema, type CapabilityArtifact } from '../artifact/schema.js';
import { DiscoveryRunner, type DiscoveryModel } from '../discovery/runner.js';
import { InMemoryRunStore, type RunRecord, type WorkflowRecord } from '../domain/store.js';
import { ControlLease } from '../handoff/lease.js';
import { DeterministicGoalInterpreter } from '../goal/interpret.js';
import { CapabilityMatcher } from '../goal/match.js';
import { OpenAICompatibleModel, DEFAULT_LLM_MODEL, normalizeLLMTimeoutMs } from '../llm/client.js';
import { PolicyGate } from '../policy/gate.js';
import { ReplayRunner } from '../replay/runner.js';
import type { SessionHandle, SurfaceAdapter, TargetProfile } from '../surface/adapter.js';
import { PlaywrightSurfaceAdapter } from '../surface/playwright.js';
import { ScriptedDemoSurfaceAdapter } from '../surface/fake.js';
import type { RunResult } from '../domain/types.js';
import { redact, type RunEvent } from '../evidence/events.js';
import { companionHtml } from './ui.js';

export type CompanionOptions = {
  offline?: boolean;
  targetUrl?: string;
  surface?: SurfaceAdapter;
  discoveryModel?: DiscoveryModel;
  storageRoot?: string;
  runtimeDir?: string;
};

function discoveryElapsedLimit(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) return 300_000;
  return Math.min(600_000, Math.max(30_000, Math.round(parsed)));
}

type RunReply = { runId: string; llmCalls: number; mode: 'discovery' | 'replay' | 'clarification' };

function defaultOfflineModel(): DiscoveryModel {
  const member = { kind: 'fill' as const, id: 'enter-member-id', target: { strategies: [{ label: 'Member ID' }] }, value: { fromInput: 'member_id' }, risk: 'READ_ONLY' as const };
  const search = { kind: 'click' as const, id: 'submit-member-search', target: { strategies: [{ role: 'button', name: 'Search' }] }, risk: 'READ_ONLY' as const };
  const scripts: Record<string, unknown[]> = {
    lookup_member_savings_balance: [member, search,
      { kind: 'click', id: 'open-member-result', target: { strategies: [{ text: 'Member Summary' }] }, risk: 'READ_ONLY' },
      { kind: 'click', id: 'open-accounts', target: { strategies: [{ text: 'Accounts' }] }, risk: 'READ_ONLY' },
      { kind: 'click', id: 'open-savings-account', target: { strategies: [{ text: 'Savings Account' }] }, risk: 'READ_ONLY' },
      { kind: 'click', id: 'open-balance-details', target: { strategies: [{ text: 'Balance Details' }] }, risk: 'READ_ONLY' },
      { kind: 'extract', id: 'extract-savings-balance', target: { strategies: [{ text: 'Current Balance' }] }, output: 'current_savings_balance', parseAs: 'money' },
      { kind: 'finish', id: 'finish', outputs: ['current_savings_balance'], checkpoint: 'Current Balance visible' }],
    lookup_member_transaction_history: [member,
      { kind: 'fill', id: 'enter-start-date', target: { strategies: [{ label: 'Start Date' }] }, value: { fromInput: 'start_date' }, risk: 'READ_ONLY' },
      { kind: 'fill', id: 'enter-end-date', target: { strategies: [{ label: 'End Date' }] }, value: { fromInput: 'end_date' }, risk: 'READ_ONLY' }, search,
      { kind: 'extract', id: 'extract-transactions', target: { strategies: [{ text: 'Transactions' }] }, output: 'transactions', parseAs: 'string' },
      { kind: 'finish', id: 'finish-transactions', outputs: ['transactions'], checkpoint: 'Transaction History' }],
    quote_member_loan_payoff: [member,
      { kind: 'fill', id: 'enter-as-of-date', target: { strategies: [{ label: 'As of Date' }] }, value: { fromInput: 'as_of_date' }, risk: 'READ_ONLY' }, search,
      { kind: 'extract', id: 'extract-payoff-quote', target: { strategies: [{ text: 'Payoff Quote' }] }, output: 'payoff_quote', parseAs: 'money' },
      { kind: 'finish', id: 'finish-payoff-quote', outputs: ['payoff_quote'], checkpoint: 'Loan Payoff Quote' }]
  };
  return {
    decide: async (_snapshot, intent, priorEvents) => {
      const script = scripts[intent.objective] ?? scripts.lookup_member_savings_balance ?? [];
      const actionIndex = priorEvents.filter((event) => event.kind === 'action').length;
      return script[actionIndex] ?? { kind: 'finish', id: 'finish', outputs: intent.requestedOutputs.map((output) => output.proposedName), checkpoint: intent.objective === 'lookup_member_savings_balance' ? 'Current Balance visible' : intent.objective === 'quote_member_loan_payoff' ? 'Loan Payoff Quote' : 'Transaction History' };
    }
  };
}

export async function createCompanion(options: CompanionOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const store = new InMemoryRunStore();
  const leases = new Map<string, ControlLease>();
  const sessions = new Map<string, SessionHandle>();
  const discoveryRunners = new Map<string, DiscoveryRunner>();
  const replayRunners = new Map<string, ReplayRunner>();
  const llmCallCounts = new Map<string, number>();
  const persistTails = new Map<string, Promise<void>>();
  const humanSinkTails = new Map<string, Promise<void>>();
  // The library is the source of truth. `learned` is retained as the legacy
  // single-workflow view exposed by /api/workflow and /api/context.
  let learned: CapabilityArtifact | undefined;
  const executionMode: 'offline' | 'live' = (options.offline ?? Boolean(options.surface || options.discoveryModel)) ? 'offline' : 'live';
  const runtimeRoot = options.runtimeDir ?? options.storageRoot ?? join(process.cwd(), 'runtime');
  // Each execution mode has its own durable namespace. Legacy offline paths are
  // mirrored for existing local demos, but are never read by live execution.
  const modeRoot = join(runtimeRoot, executionMode);
  const evidenceRoot = join(modeRoot, 'evidence');
  const artifactRoot = join(modeRoot, 'artifacts');
  const workflowRoot = join(modeRoot, 'workflows');
  const legacyEvidenceRoot = executionMode === 'offline' ? join(runtimeRoot, 'evidence') : undefined;
  const legacyArtifactRoot = executionMode === 'offline' ? join(runtimeRoot, 'artifacts') : undefined;
  const legacyWorkflowRoot = executionMode === 'offline' ? join(runtimeRoot, 'workflows') : undefined;
  // Injected surfaces/models are test seams; keep them ephemeral unless a root
  // is explicitly supplied. The standalone app still persists its default runtime.
  const runningTests = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
  const persistenceEnabled = Boolean(options.runtimeDir || options.storageRoot || (!runningTests && (options.offline === true || (!options.surface && !options.discoveryModel))));
  const target: TargetProfile = { id: 'demo-app', applicationFamily: 'legacy-member-servicing', url: options.targetUrl ?? process.env.TARGET_URL ?? 'http://localhost:3001', headless: options.offline ?? process.env.HEADLESS === '1' };
  const surface: SurfaceAdapter = options.surface ?? (options.offline ? new ScriptedDemoSurfaceAdapter({ evidenceRoot }) : new PlaywrightSurfaceAdapter({ evidenceRoot }));
  const providerEndpoint = process.env.LLM_BASE_URL ?? 'https://integrate.api.nvidia.com/v1';
  const modelId = process.env.LLM_MODEL ?? DEFAULT_LLM_MODEL;
  const llmTimeoutMs = normalizeLLMTimeoutMs(process.env.LLM_TIMEOUT_MS === undefined ? undefined : Number(process.env.LLM_TIMEOUT_MS));
  const llmActionMode = process.env.LLM_ACTION_MODE === 'tool' ? 'tool' : 'json';
  const discoveryMaxElapsedMs = discoveryElapsedLimit(process.env.DISCOVERY_MAX_ELAPSED_MS);
  const apiKey = process.env.LLM_API_KEY ?? (providerEndpoint === 'https://integrate.api.nvidia.com/v1' ? process.env.NVIDIA_API_KEY : undefined) ?? '';
  // NVIDIA's vision endpoint has been observed to return a scalar content value
  // when strict JSON Schema mode is combined with an image. Keep the typed
  // action contract in the prompt, but use the provider's more reliable JSON
  // object mode for live discovery. Tests can still exercise strict schema mode
  // directly through OpenAICompatibleModel's default.
  const liveResponseFormat = process.env.LLM_RESPONSE_FORMAT === 'json_schema' ? 'json_schema' : 'json_object';
  const model = options.discoveryModel ?? (options.offline ? defaultOfflineModel() : new OpenAICompatibleModel({ baseUrl: providerEndpoint, apiKey, model: modelId, temperature: 0, timeoutMs: llmTimeoutMs, actionMode: llmActionMode, responseFormat: liveResponseFormat }));
  // Scripted models and offline mode never advertise genuine provider readiness.
  const discoveryConfigured = executionMode === 'live' && Boolean(apiKey && providerEndpoint && modelId);
  const policy = new PolicyGate({ allowedOrigins: [new URL(target.url).origin], allowedRoutes: ['/', '/servicing*'], allowedActionKinds: ['click', 'fill', 'selectOption', 'wait', 'extract', 'finish', 'requestHuman'], maxRisk: 'READ_ONLY', controlOwner: 'automation', blockedTargetNamePatterns: ['Post Fee'] });
  const interpreter = new DeterministicGoalInterpreter();

  async function loadSavedState(): Promise<void> {
    const artifactRoots = [artifactRoot, ...(legacyArtifactRoot && legacyArtifactRoot !== artifactRoot ? [legacyArtifactRoot] : [])];
    const metadataRoots = [workflowRoot, ...(legacyWorkflowRoot && legacyWorkflowRoot !== workflowRoot ? [legacyWorkflowRoot] : [])];
    const metadataById = new Map<string, Partial<WorkflowRecord>>();
    for (const root of metadataRoots) {
      let entries;
      try { entries = await readdir(root, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        try {
          const parsed = JSON.parse(await readFile(join(root, entry.name), 'utf8')) as Partial<WorkflowRecord>;
          if (typeof parsed.id !== 'string' || typeof parsed.title !== 'string' || typeof parsed.createdAt !== 'string' || typeof parsed.updatedAt !== 'string' || typeof parsed.archived !== 'boolean') continue;
          metadataById.set(parsed.id, parsed);
        } catch { /* Ignore partial or corrupt metadata. */ }
      }
    }

    const candidates: Array<{ id: string; artifact: CapabilityArtifact; mtime: number }> = [];
    for (const root of artifactRoots) {
      let entries;
      try { entries = await readdir(root, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        const paths: Array<{ path: string; id: string }> = [];
        if (entry.isFile() && entry.name.endsWith('.json')) paths.push({ path: join(root, entry.name), id: entry.name.slice(0, -5) });
        // Accept a namespaced workflow directory as well as the flat format.
        if (entry.isDirectory()) paths.push({ path: join(root, entry.name, 'artifact.json'), id: entry.name });
        for (const candidate of paths) {
          try {
            const parsed = capabilitySchema.parse(JSON.parse(await readFile(candidate.path, 'utf8')));
            if (parsed.compatibility.applicationFamily !== target.applicationFamily || parsed.compatibility.targetProfileId !== target.id) continue;
            candidates.push({ id: candidate.id, artifact: parsed, mtime: (await stat(candidate.path)).mtimeMs });
          } catch { /* Ignore incomplete, corrupt, or incompatible artifacts. */ }
        }
      }
    }
    // The offline compatibility mirror can expose the same artifact twice.
    // Deduplicate by content while retaining the newest namespaced copy.
    candidates.sort((left, right) => right.mtime - left.mtime);
    const seenContent = new Set<string>();
    for (const candidate of candidates) {
      const content = JSON.stringify(candidate.artifact);
      if (seenContent.has(content)) continue;
      seenContent.add(content);
      const metadata = metadataById.get(candidate.id);
      const workflow = store.createWorkflow(candidate.artifact, {
        id: candidate.id,
        ...(metadata?.title ? { title: metadata.title } : {}),
        ...(metadata?.description !== undefined ? { description: metadata.description } : {}),
        ...(metadata?.archived !== undefined ? { archived: metadata.archived } : {}),
        ...(metadata?.createdAt ? { createdAt: metadata.createdAt } : {}),
        ...(metadata?.updatedAt ? { updatedAt: metadata.updatedAt } : {})
      });
    }
    learned = store.listWorkflows().find((workflow) => !workflow.archived)?.artifact;

    try {
      let evidenceReadRoot = evidenceRoot;
      try {
        const canonical = await readdir(evidenceRoot, { withFileTypes: true });
        if (!canonical.some((entry) => entry.isDirectory() && entry.name !== '')) evidenceReadRoot = legacyEvidenceRoot ?? evidenceRoot;
      } catch { evidenceReadRoot = legacyEvidenceRoot ?? evidenceRoot; }
      const directories = await readdir(evidenceReadRoot, { withFileTypes: true });
      for (const entry of directories) {
        if (!entry.isDirectory()) continue;
        try {
          const summary = JSON.parse(await readFile(join(evidenceReadRoot, entry.name, 'summary.json'), 'utf8')) as Partial<import('../domain/store.js').RunRecord> & { runId?: string };
          const restoredId = summary.id ?? summary.runId;
          if (!restoredId || !summary.goal || !summary.createdAt || !summary.status || !['succeeded', 'business_outcome', 'failed', 'aborted'].includes(summary.status)) continue;
          let events: RunEvent[] = [];
          try {
            const jsonl = await readFile(join(evidenceReadRoot, entry.name, 'run.jsonl'), 'utf8');
            events = jsonl.split(/\r?\n/).filter(Boolean).flatMap((line) => { try { return [redact(JSON.parse(line)) as RunEvent]; } catch { return []; } });
          } catch { /* Summary remains useful if event persistence was interrupted. */ }
          const summaryWorkflowId = typeof summary.workflowId === 'string' ? summary.workflowId : undefined;
          const inferredWorkflowId = summaryWorkflowId ?? (typeof summary.capabilityId === 'string'
            ? store.listWorkflows().find((workflow) => workflow.artifact.capabilityId === summary.capabilityId)?.id
            : undefined);
          store.restoreRun({
            id: restoredId, goal: summary.goal, status: summary.status, events,
            ...(summary.result ? { result: summary.result } : {}),
            ...(summary.capabilityId ? { capabilityId: summary.capabilityId } : {}),
            ...(inferredWorkflowId ? { workflowId: inferredWorkflowId } : {}),
            ...(summary.llmCalls !== undefined ? { llmCalls: summary.llmCalls } : {}),
            ...(summary.mode ? { mode: summary.mode } : {}), ...(summary.executionMode ? { executionMode: summary.executionMode } : {}), ...(summary.providerEndpoint ? { providerEndpoint: summary.providerEndpoint } : {}), ...(summary.modelId ? { modelId: summary.modelId } : {}), ...(summary.generationSettings ? { generationSettings: summary.generationSettings } : {}), createdAt: summary.createdAt
          } as import('../domain/store.js').RunRecord);
        } catch { /* Ignore non-run evidence directories and partial writes. */ }
      }
    } catch { /* A first run has no evidence directory yet. */ }
  }
  if (persistenceEnabled) await loadSavedState();

  app.addHook('onClose', async () => {
    const uniqueSessions = [...new Map([...sessions.values()].map((session) => [session.id, session])).values()];
    await Promise.allSettled(uniqueSessions.map(async (session) => {
      await surface.setHumanActionSink?.(session, undefined);
      await surface.close(session);
    }));
    sessions.clear();
    discoveryRunners.clear();
    replayRunners.clear();
    leases.clear();
  });

  async function installHumanSink(runId: string, session: SessionHandle, beforePath: string): Promise<void> {
    if (!surface.setHumanActionSink) return;
    let before = beforePath;
    let tail = Promise.resolve();
    const sink = (action: { kind: string; details?: Record<string, unknown> }): Promise<void> => {
      // Append before awaiting screenshot work. Browser bridges may fire and
      // forget callbacks when a human click causes navigation, so this is the
      // durable acknowledgement that the interaction occurred under handoff.
      const event: RunEvent = {
        runId,
        stepId: `human-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
        kind: 'human_action',
        action: redact(action),
        outcome: 'recorded',
        evidence: before ? [before] : [],
        details: before ? { beforeEvidence: before } : {},
        timestamp: new Date().toISOString()
      };
      try { store.appendEvent(runId, event); } catch { return Promise.resolve(); }
      const work = tail.catch(() => undefined).then(async () => {
        try {
          const after = await surface.captureEvidence(session);
          event.evidence = [...(before ? [before] : []), after.path];
          event.details = { ...(event.details ?? {}), beforeEvidence: before, afterEvidence: after.path };
          before = after.path;
        } catch {
          // A closing/navigating page may not permit a second screenshot. The
          // already recorded human event remains valid in that case.
        }
      });
      tail = work;
      humanSinkTails.set(runId, work);
      return work;
    };
    await surface.setHumanActionSink(session, sink);
  }

  async function flushHumanSink(runId: string): Promise<void> {
    const tail = humanSinkTails.get(runId);
    if (!tail) return;
    await tail.catch(() => undefined);
    humanSinkTails.delete(runId);
  }

  async function persistRunNow(runId: string): Promise<void> {
    if (!persistenceEnabled) return;
    const run = store.getRun(runId);
    if (!run || !['succeeded', 'business_outcome', 'failed', 'aborted'].includes(run.status)) return;
    const events = run.events.map((event) => redact(event));
    const summary = redact({ runId: run.id, id: run.id, goal: run.goal, status: run.status, result: run.result, capabilityId: run.capabilityId, workflowId: run.workflowId, llmCalls: run.llmCalls, mode: run.mode, executionMode: run.executionMode, providerEndpoint: run.providerEndpoint, modelId: run.modelId, generationSettings: run.generationSettings, createdAt: run.createdAt }) as Record<string, unknown>;
    // Durable handles and timestamps are metadata needed to restore/poll a run.
    summary.id = run.id;
    summary.runId = run.id;
    summary.createdAt = run.createdAt;
    if (run.workflowId) summary.workflowId = run.workflowId;
    if (run.result?.status === 'succeeded' && summary.result && typeof summary.result === 'object') {
      const persistedResult = summary.result as Record<string, unknown>;
      const persistedOutputs = persistedResult.outputs;
      if (persistedOutputs && typeof persistedOutputs === 'object') {
        for (const [name, value] of Object.entries(run.result.outputs)) {
          const amount = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>).amount : undefined;
          const output = (persistedOutputs as Record<string, unknown>)[name];
          if (typeof amount === 'string' && output && typeof output === 'object' && !Array.isArray(output)) (output as Record<string, unknown>).amount = amount;
          if (typeof value === 'string') (persistedOutputs as Record<string, unknown>)[name] = redactOutputText(value);
        }
      }
    }
    const writeEvidence = async (root: string): Promise<void> => {
      const directory = join(root, runId);
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, 'run.jsonl'), events.map((event) => JSON.stringify(event)).join('\n') + (events.length ? '\n' : ''));
      await writeFile(join(directory, 'summary.json'), JSON.stringify(summary, null, 2));
    };
    await writeEvidence(evidenceRoot);
    if (legacyEvidenceRoot && legacyEvidenceRoot !== evidenceRoot) await writeEvidence(legacyEvidenceRoot);
  }

  // Terminal updates can be reached by an async worker and an error handler at
  // nearly the same time. Serialize writes per run so a filesystem race cannot
  // replace the original result with UNEXPECTED_FAILURE.
  async function persistRun(runId: string): Promise<void> {
    const prior = persistTails.get(runId) ?? Promise.resolve();
    const next = prior.catch(() => undefined).then(() => persistRunNow(runId));
    persistTails.set(runId, next);
    try { await next; }
    finally { if (persistTails.get(runId) === next) persistTails.delete(runId); }
  }

  async function writeJsonAtomically(path: string, value: string): Promise<void> {
    const temporary = `${path}.tmp-${crypto.randomUUID()}`;
    try {
      await writeFile(temporary, value, { flag: 'wx' });
      await rename(temporary, path);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  async function persistWorkflow(workflow: WorkflowRecord): Promise<void> {
    if (!persistenceEnabled) return;
    const data = JSON.stringify(workflow.artifact, null, 2);
    const metadata = JSON.stringify({ id: workflow.id, title: workflow.title, ...(workflow.description !== undefined ? { description: workflow.description } : {}), archived: workflow.archived, createdAt: workflow.createdAt, updatedAt: workflow.updatedAt }, null, 2);
    await mkdir(artifactRoot, { recursive: true });
    await mkdir(workflowRoot, { recursive: true });
    // Workflow IDs are opaque handles generated by this process (or validated
    // filenames from imported artifacts), so they are safe as single path
    // segments. Metadata and artifact are separate files to prevent metadata
    // edits from ever mutating the executable action list.
    await writeJsonAtomically(join(artifactRoot, `${workflow.id}.json`), data);
    await writeJsonAtomically(join(workflowRoot, `${workflow.id}.json`), metadata);
    if (legacyArtifactRoot && legacyArtifactRoot !== artifactRoot) {
      await mkdir(legacyArtifactRoot, { recursive: true });
      // Keep the old capability filename for existing demos, but do not let a
      // second workflow overwrite it and reintroduce the old collision.
      try { await stat(join(legacyArtifactRoot, `${workflow.artifact.capabilityId}.json`)); }
      catch { await writeJsonAtomically(join(legacyArtifactRoot, `${workflow.artifact.capabilityId}.json`), data); }
    }
    if (legacyWorkflowRoot && legacyWorkflowRoot !== workflowRoot) {
      await mkdir(legacyWorkflowRoot, { recursive: true });
      await writeJsonAtomically(join(legacyWorkflowRoot, `${workflow.id}.json`), metadata);
    }
  }

  async function finishUnexpectedFailure(runId: string, error: unknown): Promise<RunReply> {
    const run = store.getRun(runId);
    if (!run) throw new Error('run_not_found');
    const message = error instanceof Error ? error.message : String(error);
    const result: RunResult = { status: 'failed', error: { code: 'UNEXPECTED_FAILURE', message } };
    store.updateRun(runId, { status: 'failed', result, llmCalls: llmCallCounts.get(runId) ?? run.llmCalls ?? 0 });
    appendResultEvent(store, runId, result, llmCallCounts.get(runId) ?? run.llmCalls ?? 0);
    await persistRun(runId).catch(() => undefined);
    const session = sessions.get(runId);
    if (session) await Promise.resolve(surface.setHumanActionSink?.(session, undefined)).catch(() => undefined);
    if (session) await Promise.resolve(surface.close(session)).catch(() => undefined);
    sessions.delete(runId);
    discoveryRunners.delete(runId);
    replayRunners.delete(runId);
    leases.delete(runId);
    llmCallCounts.delete(runId);
    return { runId, llmCalls: run.llmCalls ?? 0, mode: run.mode ?? 'clarification' };
  }

  function publicRun(run: import('../domain/store.js').RunRecord): Record<string, unknown> {
    const safe = redact(run) as Record<string, unknown>;
    // UUIDs are opaque handles rather than member data; clients need them for polling.
    safe.id = run.id;
    if (run.sessionId) safe.sessionId = run.sessionId;
    if (run.interventionId) safe.interventionId = run.interventionId;
    if (run.workflowId) safe.workflowId = run.workflowId;
    if (run.result?.status === 'succeeded' && safe.result && typeof safe.result === 'object') {
      const safeResult = safe.result as Record<string, unknown>;
      const safeOutputs = safeResult.outputs;
      if (safeOutputs && typeof safeOutputs === 'object' && run.result.outputs) {
        for (const [name, value] of Object.entries(run.result.outputs)) {
          if (value && typeof value === 'object' && !Array.isArray(value) && typeof (value as Record<string, unknown>).amount === 'string') {
            const output = (safeOutputs as Record<string, unknown>)[name];
            if (output && typeof output === 'object' && !Array.isArray(output)) (output as Record<string, unknown>).amount = (value as Record<string, unknown>).amount;
          }
          if (typeof value === 'string') (safeOutputs as Record<string, unknown>)[name] = redactOutputText(value);
        }
      }
    }
    return safe;
  }

  function workflowSummary(workflow: WorkflowRecord): Record<string, unknown> {
    const runs = store.listRunsForWorkflow(workflow.id);
    const counts = {
      total: runs.length,
      succeeded: runs.filter((run) => run.status === 'succeeded').length,
      businessOutcome: runs.filter((run) => run.status === 'business_outcome').length,
      failed: runs.filter((run) => run.status === 'failed').length,
      needsHuman: runs.filter((run) => run.status === 'needs_human' || run.status === 'paused').length,
      aborted: runs.filter((run) => run.status === 'aborted').length
    };
    return {
      id: workflow.id,
      capabilityId: workflow.artifact.capabilityId,
      version: workflow.artifact.version,
      title: workflow.title,
      ...(workflow.description !== undefined ? { description: workflow.description } : {}),
      archived: workflow.archived,
      inputs: workflow.artifact.inputs,
      outputs: workflow.artifact.outputs,
      createdAt: workflow.createdAt,
      updatedAt: workflow.updatedAt,
      runCount: counts.total,
      lastRunAt: runs[0]?.createdAt,
      counts
    };
  }

  function matchWorkflows(candidates: WorkflowRecord[], goal: string, objective?: string):
    | { kind: 'match'; workflow: WorkflowRecord; slots: Record<string, string> }
    | { kind: 'ambiguous' }
    | { kind: 'clarification'; message: string }
    | { kind: 'miss' } {
    const familyCandidates = objective ? candidates.filter((workflow) => workflow.artifact.intentSignature.intent === objective) : candidates;
    if (familyCandidates.length === 0) return { kind: 'miss' };
    const signatures = familyCandidates.map((workflow) => workflow.artifact.intentSignature);
    const match = new CapabilityMatcher(signatures).match(goal);
    if (match.kind === 'match') {
      const workflow = familyCandidates.find((candidate) => candidate.artifact.intentSignature === match.capability);
      return workflow ? { kind: 'match', workflow, slots: match.slots } : { kind: 'miss' };
    }
    if (match.kind === 'ambiguous') return { kind: 'ambiguous' };
    if (match.kind === 'clarification') return { kind: 'clarification', message: match.message };
    return { kind: 'miss' };
  }

  function validateWorkflowInputs(workflow: WorkflowRecord, rawInputs: unknown): { ok: true; inputs: Record<string, string> } | { ok: false; details: Array<{ field: string; code: string; message: string }> } {
    if (!rawInputs || typeof rawInputs !== 'object' || Array.isArray(rawInputs)) {
      return { ok: false, details: [{ field: 'inputs', code: 'TYPE', message: 'inputs must be an object' }] };
    }
    const source = rawInputs as Record<string, unknown>;
    const details: Array<{ field: string; code: string; message: string }> = [];
    const values: Record<string, string> = {};
    const declared = new Set(workflow.artifact.inputs.map((input) => input.name));
    for (const name of Object.keys(source)) {
      if (!declared.has(name)) details.push({ field: name, code: 'UNKNOWN', message: `Unknown input: ${name}` });
    }
    for (const input of workflow.artifact.inputs) {
      const value = source[input.name];
      if (value === undefined) {
        details.push({ field: input.name, code: 'MISSING', message: `Missing input: ${input.name}` });
        continue;
      }
      if (input.type === 'string' && typeof value !== 'string') {
        details.push({ field: input.name, code: 'TYPE', message: `Input ${input.name} must be a string` });
        continue;
      }
      const stringValue = value as string;
      if (stringValue.length < input.validation.minLength || stringValue.length > input.validation.maxLength) {
        details.push({ field: input.name, code: 'LENGTH', message: `Input ${input.name} must be ${input.validation.minLength}-${input.validation.maxLength} characters` });
        continue;
      }
      if ((input.validation.format === 'iso_date' || input.sensitivity === 'date') && !isIsoDateInput(stringValue)) {
        details.push({ field: input.name, code: 'FORMAT', message: `Input ${input.name} must be a valid ISO date (YYYY-MM-DD)` });
        continue;
      }
      values[input.name] = stringValue;
    }
    return details.length ? { ok: false, details } : { ok: true, inputs: values };
  }

  async function replayWorkflow(runId: string, workflow: WorkflowRecord, inputs: Record<string, string>): Promise<RunReply> {
    const run = store.getRun(runId);
    if (!run) throw new Error('run_not_found');
    const lease = new ControlLease();
    leases.set(runId, lease);
    store.updateRun(runId, { status: 'running', workflowId: workflow.id, capabilityId: workflow.artifact.capabilityId, mode: 'replay', llmCalls: 0 });
    try {
      const replayRunner = new ReplayRunner(surface, new PolicyGate(workflow.artifact.policyProfile), lease, async (reason, stepId, screenshot) => store.openIntervention(runId, reason, stepId, screenshot.path).id, (event: RunEvent) => store.appendEvent(runId, event));
      const replay = await replayRunner.run(capabilitySchema.parse(workflow.artifact), target, inputs);
      if (replayRunner.lastSession) sessions.set(runId, replayRunner.lastSession);
      if (replay.status === 'needs_human') replayRunners.set(runId, replayRunner);
      store.updateRun(runId, { status: statusFor(replay), result: replay, workflowId: workflow.id, capabilityId: workflow.artifact.capabilityId, ...(replayRunner.lastSession ? { sessionId: replayRunner.lastSession.id } : {}), llmCalls: 0, mode: 'replay', events: replayRunner.events });
      appendResultEvent(store, runId, replay, 0);
      if (replay.status !== 'needs_human') await persistRun(runId).catch(() => undefined);
      if (replay.status !== 'needs_human' && replayRunner.lastSession) {
        await surface.close(replayRunner.lastSession);
        sessions.delete(runId);
      }
      if (replay.status !== 'needs_human') replayRunners.delete(runId);
      return { runId, llmCalls: 0, mode: 'replay' };
    } catch (error) {
      return finishUnexpectedFailure(runId, error);
    }
  }

  async function execute(runId: string, goal: string): Promise<RunReply> {
    const run = store.getRun(runId);
    if (!run) throw new Error('run_not_found');
    const lease = new ControlLease(); leases.set(runId, lease);
    store.updateRun(runId, { status: 'running' });
    let intent;
    try { intent = await interpreter.interpret(goal); } catch (error) {
      const result: RunResult = { status: 'failed', error: { code: 'CLARIFICATION_REQUIRED', message: error instanceof Error ? error.message : String(error) } };
      store.updateRun(runId, { status: 'failed', result, llmCalls: 0, mode: 'clarification' });
      appendResultEvent(store, runId, result, 0);
      await persistRun(runId).catch(() => undefined);
      leases.delete(runId);
      return { runId, llmCalls: 0, mode: 'clarification' };
    }
    try {
      const workflows = store.listWorkflows();
      const active = workflows.filter((workflow) => !workflow.archived);
      const activeMatch = matchWorkflows(active, goal, intent.objective);
      if (activeMatch.kind === 'clarification' || activeMatch.kind === 'ambiguous') {
        const result: RunResult = { status: 'failed', error: { code: 'CLARIFICATION_REQUIRED', message: activeMatch.kind === 'clarification' ? activeMatch.message : 'More than one workflow matches this request.' } };
        store.updateRun(runId, { status: 'failed', result, llmCalls: 0, mode: 'clarification' });
        appendResultEvent(store, runId, result, 0);
        await persistRun(runId).catch(() => undefined);
        leases.delete(runId);
        return { runId, llmCalls: 0, mode: 'clarification' };
      }
      if (activeMatch.kind === 'match') {
        return replayWorkflow(runId, activeMatch.workflow, activeMatch.slots);
      }
      // An archived workflow is an explicit operator choice. A natural
      // language miss must never silently rediscover and replace that workflow.
      const archivedMatch = matchWorkflows(workflows.filter((workflow) => workflow.archived), goal, intent.objective);
      if (archivedMatch.kind === 'match' || archivedMatch.kind === 'ambiguous' || archivedMatch.kind === 'clarification') {
        const message = archivedMatch.kind === 'match' ? `Workflow "${archivedMatch.workflow.title}" is archived. Restore it before running this request.` : archivedMatch.kind === 'clarification' ? archivedMatch.message : 'More than one archived workflow matches this request.';
        const result: RunResult = { status: 'failed', error: { code: 'WORKFLOW_ARCHIVED', message } };
        store.updateRun(runId, { status: 'failed', result, llmCalls: 0, mode: 'clarification' });
        appendResultEvent(store, runId, result, 0);
        await persistRun(runId).catch(() => undefined);
        leases.delete(runId);
        return { runId, llmCalls: 0, mode: 'clarification' };
      }
    let llmCalls = 0;
      const counted: DiscoveryModel = {
        decide: async (snapshot, currentIntent, events) => { llmCalls += 1; llmCallCounts.set(runId, llmCalls); return model.decide(snapshot, currentIntent, events); }
      };
      if (model.repair) counted.repair = async (snapshot, currentIntent, events, context) => {
        llmCalls += 1;
        llmCallCounts.set(runId, llmCalls);
        return model.repair!(snapshot, currentIntent, events, context);
      };
    llmCallCounts.set(runId, 0);
    const discoveryRunner = new DiscoveryRunner(surface, counted, policy, lease, { maxActions: 32, maxElapsedMs: discoveryMaxElapsedMs, onHuman: async (reason, stepId, screenshot) => store.openIntervention(runId, reason, stepId, screenshot.path).id, onEvent: (event: RunEvent) => store.appendEvent(runId, event) });
    discoveryRunners.set(runId, discoveryRunner);
    const discovery = await discoveryRunner.run(intent, target);
    const discoveryResult = discovery.runResult.status === 'succeeded' && discovery.artifact && !canPersistDiscoveredWorkflow(discovery.artifact, discovery.runResult)
      ? invalidCompiledWorkflowResult()
      : discovery.runResult;
    if (discovery.runResult.status === 'succeeded' && discovery.artifact && canPersistDiscoveredWorkflow(discovery.artifact, discovery.runResult)) {
      const workflow = store.createWorkflow(discovery.artifact);
      learned = workflow.artifact;
      await persistWorkflow(workflow);
      store.updateRun(runId, { workflowId: workflow.id });
    }
    sessions.set(runId, discovery.session);
    llmCallCounts.set(runId, llmCalls);
    const discoveredWorkflow = discovery.artifact ? store.listWorkflows().find((workflow) => workflow.artifact === discovery.artifact) : undefined;
    store.updateRun(runId, { status: statusFor(discoveryResult), result: discoveryResult, ...(discovery.artifact ? { capabilityId: discovery.artifact.capabilityId } : {}), ...(discoveredWorkflow ? { workflowId: discoveredWorkflow.id } : {}), sessionId: discovery.session.id, events: discovery.events, llmCalls, mode: 'discovery' });
    appendResultEvent(store, runId, discoveryResult, llmCalls);
    if (discoveryResult.status !== 'needs_human') await persistRun(runId).catch(() => undefined);
    if (discoveryResult.status !== 'needs_human') {
      discoveryRunners.delete(runId);
      await surface.close(discovery.session);
      sessions.delete(runId);
    }
    return { runId, llmCalls, mode: 'discovery' };
    } catch (error) {
      const current = store.getRun(runId);
      if (current?.result && ['succeeded', 'business_outcome', 'failed', 'aborted'].includes(current.status)) {
        await persistRun(runId).catch(() => undefined);
        return { runId, llmCalls: current.llmCalls ?? 0, mode: current.mode ?? 'discovery' };
      }
      return finishUnexpectedFailure(runId, error);
    }
  }

  app.get('/', async (_request, reply) => reply.type('text/html').send(companionHtml));
  app.post<{ Body: { goal?: string } }>('/api/tasks', async (request, reply) => {
    const goal = request.body?.goal;
    if (typeof goal !== 'string' || !goal.trim()) return reply.code(400).send({ error: 'goal must be one plain-language sentence' });
    const run = store.createRun(goal.trim());
    store.updateRun(run.id, { executionMode, ...(executionMode === 'live' ? { providerEndpoint, modelId, generationSettings: { temperature: 0, timeoutMs: llmTimeoutMs, actionMode: llmActionMode } } : {}) });
    const prefersAsync = String(request.headers.prefer ?? '').toLowerCase().split(',').some((value) => value.trim() === 'respond-async');
    if (prefersAsync) {
      void execute(run.id, goal.trim()).catch((error) => finishUnexpectedFailure(run.id, error));
      return reply.code(202).send({ runId: run.id, status: 'pending' });
    }
    const result = await execute(run.id, goal.trim());
    return reply.code(201).send(result);
  });
  app.get('/api/context', async () => ({ appName: 'Demo Credit Union', workspaceName: 'Member Servicing', targetUrl: target.url, executionMode, discoveryConfigured, learnedWorkflow: learned ?? null }));
  app.get('/api/workflow', async () => learned ?? null);
  app.get('/api/workflows', async () => store.listWorkflows().map((workflow) => workflowSummary(workflow)));
  app.get<{ Params: { id: string } }>('/api/workflows/:id', async (request, reply) => {
    const workflow = store.getWorkflow(request.params.id);
    if (!workflow) return reply.code(404).send({ error: 'workflow_not_found' });
    const summary = workflowSummary(workflow);
    const runs = store.listRunsForWorkflow(workflow.id).slice(0, 20).map((run) => publicRun(run));
    return { ...summary, artifact: capabilitySchema.parse(workflow.artifact), runs, recentRuns: runs };
  });
  app.patch<{ Params: { id: string }; Body: { title?: unknown; description?: unknown; archived?: unknown } }>('/api/workflows/:id', async (request, reply) => {
    const workflow = store.getWorkflow(request.params.id);
    if (!workflow) return reply.code(404).send({ error: 'workflow_not_found' });
    const body = request.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply.code(400).send({ error: 'invalid_workflow_metadata' });
    const keys = Object.keys(body as Record<string, unknown>);
    if (keys.some((key) => !['title', 'description', 'archived'].includes(key))) return reply.code(400).send({ error: 'workflow_metadata_only' });
    const changes: { title?: string; description?: string | null; archived?: boolean } = {};
    if ('title' in body) {
      if (typeof body.title !== 'string' || !body.title.trim() || body.title.length > 200) return reply.code(400).send({ error: 'invalid_workflow_title' });
      changes.title = body.title.trim();
    }
    if ('description' in body) {
      if (body.description !== null && (typeof body.description !== 'string' || body.description.length > 1000)) return reply.code(400).send({ error: 'invalid_workflow_description' });
      changes.description = body.description as string | null;
    }
    if ('archived' in body && typeof body.archived !== 'boolean') return reply.code(400).send({ error: 'invalid_workflow_archived' });
    if ('archived' in body) changes.archived = body.archived as boolean;
    const before = { id: workflow.id, title: workflow.title, ...(workflow.description !== undefined ? { description: workflow.description } : {}), archived: workflow.archived, createdAt: workflow.createdAt, updatedAt: workflow.updatedAt, artifact: workflow.artifact };
    const updated = store.updateWorkflowMetadata(workflow.id, changes);
    try {
      await persistWorkflow(updated);
    } catch (error) {
      store.restoreWorkflow(before);
      return reply.code(500).send({ error: 'workflow_persistence_failed', message: error instanceof Error ? error.message : String(error) });
    }
    learned = store.listWorkflows().find((candidate) => !candidate.archived)?.artifact;
    return workflowSummary(updated);
  });
  app.post<{ Params: { id: string }; Body: { inputs?: unknown } }>('/api/workflows/:id/runs', async (request, reply) => {
    const workflow = store.getWorkflow(request.params.id);
    if (!workflow) return reply.code(404).send({ error: 'workflow_not_found' });
    if (workflow.archived) return reply.code(409).send({ error: 'workflow_archived' });
    const validated = validateWorkflowInputs(workflow, request.body?.inputs);
    if (!validated.ok) return reply.code(400).send({ error: 'invalid_inputs', code: 'INVALID_INPUT', details: validated.details });
    const run = store.createRun(workflow.title);
    store.updateRun(run.id, { executionMode, workflowId: workflow.id, capabilityId: workflow.artifact.capabilityId, mode: 'replay', llmCalls: 0 });
    const prefersAsync = String(request.headers.prefer ?? '').toLowerCase().split(',').some((value) => value.trim() === 'respond-async');
    if (prefersAsync) {
      void replayWorkflow(run.id, workflow, validated.inputs).catch((error) => finishUnexpectedFailure(run.id, error));
      return reply.code(202).send({ runId: run.id, status: 'pending', llmCalls: 0, mode: 'replay' });
    }
    return reply.code(201).send(await replayWorkflow(run.id, workflow, validated.inputs));
  });
  app.get('/api/runs', async () => store.listRuns().map((run) => publicRun(run)));
  app.get<{ Params: { runId: string } }>('/api/runs/:runId', async (request, reply) => {
    const run = store.getRun(request.params.runId);
    if (!run) return reply.code(404).send({ error: 'run_not_found' });
    const interventionId = run.interventionId ?? store.getInterventionForRun(run.id)?.id;
    return publicRun(interventionId ? { ...run, interventionId } : run);
  });
  app.get<{ Params: { runId: string } }>('/api/runs/:runId/events', async (request, reply) => {
    const run = store.getRun(request.params.runId);
    if (!run) return reply.code(404).send({ error: 'run_not_found' });
    return run.events.map((event) => redact(event));
  });
  app.get<{ Params: { id: string } }>('/api/interventions/:id', async (request, reply) => {
    const intervention = store.getIntervention(request.params.id);
    if (!intervention) return reply.code(404).send({ error: 'intervention_not_found' });
    return intervention;
  });
  app.get<{ Params: { id: string } }>('/api/interventions/:id/screenshot', async (request, reply) => {
    const intervention = store.getIntervention(request.params.id);
    if (!intervention) return reply.code(404).send({ error: 'intervention_not_found' });
    reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    reply.header('Pragma', 'no-cache');
    reply.header('Expires', '0');
    try {
      const session = sessions.get(intervention.runId);
      if (session && intervention.status === 'claimed') {
        const latest = await surface.captureEvidence(session);
        store.updateInterventionScreenshot(intervention.id, latest.path);
      }
      return reply.type('image/png').send(await readFile(store.getIntervention(intervention.id)!.screenshotPath));
    } catch { return reply.code(404).send({ error: 'screenshot_not_found' }); }
  });
  app.post<{ Params: { id: string } }>('/api/interventions/:id/claim', async (request, reply) => {
    const intervention = store.getIntervention(request.params.id); if (!intervention) return reply.code(404).send({ error: 'intervention_not_found' });
    const lease = leases.get(intervention.runId); const session = sessions.get(intervention.runId); if (!lease || !session) return reply.code(409).send({ error: 'session_not_available' });
    try {
      lease.claim('human');
      await surface.bringToHuman(session);
      await installHumanSink(intervention.runId, session, (await surface.captureEvidence(session)).path);
      store.updateIntervention(intervention.id, 'claimed');
      store.updateRun(intervention.runId, { status: 'paused' });
      return { status: 'claimed', sessionId: session.id };
    } catch (error) { return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) }); }
  });
  app.post<{ Params: { id: string } }>('/api/interventions/:id/resume', async (request, reply) => {
    const intervention = store.getIntervention(request.params.id); if (!intervention) return reply.code(404).send({ error: 'intervention_not_found' });
    const lease = leases.get(intervention.runId); const session = sessions.get(intervention.runId); if (!lease || !session) return reply.code(409).send({ error: 'session_not_available' });
    try {
      // A browser event can arrive while the operator is being released. Let
      // queued browser bridge calls and their evidence finish while the human
      // still owns the lease, before removing the sink.
      await surface.flushHumanActionEvents?.(session);
      await flushHumanSink(intervention.runId);
      lease.resume('human');
      await surface.setHumanActionSink?.(session, undefined);
      const runner = discoveryRunners.get(intervention.runId);
      const replayRunner = replayRunners.get(intervention.runId);
      if (!runner && !replayRunner) return reply.code(409).send({ error: 'continuation_not_available' });
      store.updateIntervention(intervention.id, 'resumed');
      if (runner) {
        const priorEvents = [...(store.getRun(intervention.runId)?.events ?? [])];
        const resumed = await runner.resume();
        const resumedResult = resumed.runResult.status === 'succeeded' && resumed.artifact && !canPersistDiscoveredWorkflow(resumed.artifact, resumed.runResult)
          ? invalidCompiledWorkflowResult()
          : resumed.runResult;
        if (resumed.runResult.status === 'succeeded' && resumed.artifact && canPersistDiscoveredWorkflow(resumed.artifact, resumed.runResult)) {
          const workflow = store.createWorkflow(resumed.artifact);
          learned = workflow.artifact;
          await persistWorkflow(workflow);
          store.updateRun(intervention.runId, { workflowId: workflow.id });
        }
        store.updateRun(intervention.runId, { status: statusFor(resumedResult), result: resumedResult, ...(resumed.artifact ? { capabilityId: resumed.artifact.capabilityId } : {}), events: mergeRunEvents(priorEvents, resumed.events), sessionId: session.id, llmCalls: llmCallCounts.get(intervention.runId) ?? 0 });
        if (resumedResult.status !== 'needs_human') discoveryRunners.delete(intervention.runId);
        if (resumedResult.status !== 'needs_human') { replayRunners.delete(intervention.runId); }

      } else {
        const priorEvents = [...(store.getRun(intervention.runId)?.events ?? [])];
        const resumed = await replayRunner!.resume();
        const replayEvents = (replayRunner as ReplayRunner & { events?: RunEvent[] }).events;
        store.updateRun(intervention.runId, { status: statusFor(resumed), result: resumed, sessionId: session.id, ...(replayEvents ? { events: mergeRunEvents(priorEvents, replayEvents) } : {}) });
        if (resumed.status !== 'needs_human') replayRunners.delete(intervention.runId);

      }
      const resumedRun = store.getRun(intervention.runId)!;
      const resumedLlmCalls = resumedRun.llmCalls ?? llmCallCounts.get(intervention.runId) ?? 0;
      store.updateRun(intervention.runId, { llmCalls: resumedLlmCalls });
      appendResultEvent(store, intervention.runId, resumedRun.result!, resumedLlmCalls);
      const terminal = store.getRun(intervention.runId)?.status;
      if (terminal !== 'needs_human') await persistRun(intervention.runId);
      if (terminal !== 'needs_human') {
        await surface.setHumanActionSink?.(session, undefined);
        await surface.close(session);
        sessions.delete(intervention.runId);
      }
      return { status: 'resumed', sessionId: session.id, sameSession: true };
    } catch (error) { return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) }); }
  });
  app.post<{ Params: { id: string } }>('/api/interventions/:id/abort', async (request, reply) => {
    const intervention = store.getIntervention(request.params.id); if (!intervention) return reply.code(404).send({ error: 'intervention_not_found' });
    const lease = leases.get(intervention.runId); if (!lease) return reply.code(409).send({ error: 'session_not_available' });
    lease.abort();
    const session = sessions.get(intervention.runId);
    if (session) await surface.setHumanActionSink?.(session, undefined);
    if (session) { await surface.close(session); sessions.delete(intervention.runId); }
    discoveryRunners.delete(intervention.runId); replayRunners.delete(intervention.runId);
    store.updateIntervention(intervention.id, 'aborted');
    store.updateRun(intervention.runId, { status: 'aborted', result: { status: 'failed', error: { code: 'ABORTED', message: 'Run aborted by human operator' } } });
    await persistRun(intervention.runId);
    return { status: 'aborted' };
  });
  app.post<{ Params: { id: string }; Body: { kind?: string; details?: unknown } }>('/api/interventions/:id/actions', async (request, reply) => {
    const intervention = store.getIntervention(request.params.id); if (!intervention) return reply.code(404).send({ error: 'intervention_not_found' });
    if (intervention.status !== 'claimed') return reply.code(409).send({ error: 'human_control_required' });
    const event: RunEvent = { runId: intervention.runId, stepId: 'human', kind: 'human_action', outcome: 'recorded', action: redact({ kind: request.body?.kind ?? 'unknown', details: request.body?.details }), evidence: [] };
    store.appendEvent(intervention.runId, event); return { status: 'recorded' };
  });
  return app;
}

function redactOutputText(value: string): string {
  // Preserve date semantics in transaction rows while still masking any
  // member/account identifiers that happen to be rendered in the text.
  const dates: string[] = [];
  const withPlaceholders = value.replace(/\b\d{4}-\d{2}-\d{2}\b/g, (date) => {
    const marker = `__DATE_${dates.length}__`;
    dates.push(date);
    return marker;
  });
  const masked = withPlaceholders.replace(/\b\d{4,}\b/g, '[REDACTED]');
  return masked.replace(/__DATE_(\d+)__/g, (_match, index: string) => dates[Number(index)] ?? '[REDACTED]');
}

function isIsoDateInput(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function statusFor(result: RunResult): 'succeeded' | 'business_outcome' | 'needs_human' | 'failed' { return result.status; }
function invalidCompiledWorkflowResult(): RunResult {
  return {
    status: 'failed',
    error: {
      code: 'CAPABILITY_COMPILE_INVALID',
      message: 'Discovery completed without a complete observed input, output, and finish trace; no workflow was saved.'
    }
  };
}
function canPersistDiscoveredWorkflow(artifact: CapabilityArtifact, result: RunResult): boolean {
  if (result.status !== 'succeeded') return false;
  const outputs = result.outputs ?? {};
  if (artifact.outputs.some((output) => !(output.name in outputs))) return false;
  const successfulActions = artifact.actions.filter((action) => action.kind === 'finish' || action.kind === 'fill' || action.kind === 'selectOption');
  if (!successfulActions.some((action) => action.kind === 'finish' && action.checkpoint === artifact.finalCheckpoint)) return false;
  return artifact.inputs.every((input) => successfulActions.some((action) =>
    (action.kind === 'fill' && typeof action.value === 'object' && action.value.fromInput === input.name) ||
    (action.kind === 'selectOption' && typeof action.option === 'object' && action.option.fromInput === input.name)
  ));
}

function eventIdentity(event: RunEvent): string {
  // Recorder events carry timestamps. The fallback keeps legacy result and
  // manually appended events stable without relying on object identity.
  return JSON.stringify([event.kind, event.stepId, event.timestamp ?? '', event.outcome, event.action ?? null, event.details ?? null]);
}

function mergeRunEvents(existing: RunEvent[], incoming: RunEvent[]): RunEvent[] {
  const merged: RunEvent[] = [];
  const seen = new Set<string>();
  for (const event of [...existing, ...incoming]) {
    const key = eventIdentity(event);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(event);
  }
  return merged;
}

function appendResultEvent(store: InMemoryRunStore, runId: string, result: RunResult, llmCalls: number): void {
  const existing = store.getRun(runId)?.events.some((event) => event.kind === 'result' && event.stepId === 'result' && event.outcome === result.status);
  if (existing) return;
  store.appendEvent(runId, { runId, stepId: 'result', kind: 'result', outcome: result.status, details: { llmCalls }, evidence: [] });
}
