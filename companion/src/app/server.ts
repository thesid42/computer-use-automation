import Fastify, { type FastifyInstance } from 'fastify';
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { capabilitySchema, type CapabilityArtifact } from '../artifact/schema.js';
import { DiscoveryRunner, type DiscoveryModel } from '../discovery/runner.js';
import { InMemoryRunStore } from '../domain/store.js';
import { ControlLease } from '../handoff/lease.js';
import { DeterministicGoalInterpreter } from '../goal/interpret.js';
import { CapabilityMatcher } from '../goal/match.js';
import { OpenAICompatibleModel, ScriptedDiscoveryModel, DEFAULT_LLM_MODEL, normalizeLLMTimeoutMs } from '../llm/client.js';
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

type RunReply = { runId: string; llmCalls: number; mode: 'discovery' | 'replay' | 'clarification' };

function defaultOfflineModel(): DiscoveryModel {
  return new ScriptedDiscoveryModel([
    { kind: 'fill', id: 'enter-member-id', target: { strategies: [{ label: 'Member ID' }] }, value: { fromInput: 'member_id' }, risk: 'READ_ONLY' },
    { kind: 'click', id: 'submit-member-search', target: { strategies: [{ role: 'button', name: 'Search' }] }, risk: 'READ_ONLY' },
    { kind: 'click', id: 'open-member-result', target: { strategies: [{ text: 'Member Summary' }] }, risk: 'READ_ONLY' },
    { kind: 'click', id: 'open-accounts', target: { strategies: [{ text: 'Accounts' }] }, risk: 'READ_ONLY' },
    { kind: 'click', id: 'open-savings-account', target: { strategies: [{ text: 'Savings Account' }] }, risk: 'READ_ONLY' },
    { kind: 'click', id: 'open-balance-details', target: { strategies: [{ text: 'Balance Details' }] }, risk: 'READ_ONLY' },
    { kind: 'extract', id: 'extract-savings-balance', target: { strategies: [{ text: 'Current Balance' }] }, output: 'current_savings_balance', parseAs: 'money' },
    { kind: 'finish', id: 'finish', outputs: ['current_savings_balance'], checkpoint: 'Current Balance visible' }
  ]);
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
  let learned: CapabilityArtifact | undefined;
  const executionMode: 'offline' | 'live' = (options.offline ?? Boolean(options.surface || options.discoveryModel)) ? 'offline' : 'live';
  const runtimeRoot = options.runtimeDir ?? options.storageRoot ?? join(process.cwd(), 'runtime');
  // Each execution mode has its own durable namespace. Legacy offline paths are
  // mirrored for existing local demos, but are never read by live execution.
  const modeRoot = join(runtimeRoot, executionMode);
  const evidenceRoot = join(modeRoot, 'evidence');
  const artifactRoot = join(modeRoot, 'artifacts');
  const legacyEvidenceRoot = executionMode === 'offline' ? join(runtimeRoot, 'evidence') : undefined;
  const legacyArtifactRoot = executionMode === 'offline' ? join(runtimeRoot, 'artifacts') : undefined;
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
    try {
      const candidates: Array<{ artifact: CapabilityArtifact; mtime: number }> = [];
      for (const root of artifactRoots) {
        let names: string[];
        try { names = await readdir(root); } catch { continue; }
        for (const name of names) {
          if (!name.endsWith('.json')) continue;
          try {
            const path = join(root, name);
            const parsed = capabilitySchema.parse(JSON.parse(await readFile(path, 'utf8')));
            if (parsed.compatibility.applicationFamily !== target.applicationFamily || parsed.compatibility.targetProfileId !== target.id) continue;
            candidates.push({ artifact: parsed, mtime: (await stat(path)).mtimeMs });
          } catch { /* Ignore incomplete, corrupt, or incompatible artifacts. */ }
        }
      }
      candidates.sort((left, right) => right.mtime - left.mtime);
      learned = candidates[0]?.artifact;
    } catch { /* A first run has no artifact directory yet. */ }

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
          store.restoreRun({
            id: restoredId, goal: summary.goal, status: summary.status, events,
            ...(summary.result ? { result: summary.result } : {}),
            ...(summary.capabilityId ? { capabilityId: summary.capabilityId } : {}),
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
    await surface.setHumanActionSink(session, async (action) => {
      const after = await surface.captureEvidence(session);
      const event: RunEvent = {
        runId, stepId: `human-${Date.now()}`, kind: 'human_action', action: redact(action), outcome: 'recorded',
        evidence: [before, after.path], details: { beforeEvidence: before, afterEvidence: after.path }
      };
      store.appendEvent(runId, event);
      before = after.path;
    });
  }

  async function persistRunNow(runId: string): Promise<void> {
    if (!persistenceEnabled) return;
    const run = store.getRun(runId);
    if (!run || !['succeeded', 'business_outcome', 'failed', 'aborted'].includes(run.status)) return;
    const events = run.events.map((event) => redact(event));
    const summary = redact({ runId: run.id, id: run.id, goal: run.goal, status: run.status, result: run.result, capabilityId: run.capabilityId, llmCalls: run.llmCalls, mode: run.mode, executionMode: run.executionMode, providerEndpoint: run.providerEndpoint, modelId: run.modelId, generationSettings: run.generationSettings, createdAt: run.createdAt }) as Record<string, unknown>;
    // Durable handles and timestamps are metadata needed to restore/poll a run.
    summary.id = run.id;
    summary.runId = run.id;
    summary.createdAt = run.createdAt;
    if (run.result?.status === 'succeeded' && summary.result && typeof summary.result === 'object') {
      const persistedResult = summary.result as Record<string, unknown>;
      const persistedOutputs = persistedResult.outputs;
      if (persistedOutputs && typeof persistedOutputs === 'object') {
        for (const [name, value] of Object.entries(run.result.outputs)) {
          const amount = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>).amount : undefined;
          const output = (persistedOutputs as Record<string, unknown>)[name];
          if (typeof amount === 'string' && output && typeof output === 'object' && !Array.isArray(output)) (output as Record<string, unknown>).amount = amount;
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

  async function persistArtifact(artifact: CapabilityArtifact): Promise<void> {
    if (!persistenceEnabled) return;
    const data = JSON.stringify(artifact, null, 2);
    await mkdir(artifactRoot, { recursive: true });
    await writeFile(join(artifactRoot, `${artifact.capabilityId}.json`), data);
    if (legacyArtifactRoot && legacyArtifactRoot !== artifactRoot) {
      await mkdir(legacyArtifactRoot, { recursive: true });
      await writeFile(join(legacyArtifactRoot, `${artifact.capabilityId}.json`), data);
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
    if (run.result?.status === 'succeeded' && safe.result && typeof safe.result === 'object') {
      const safeResult = safe.result as Record<string, unknown>;
      const safeOutputs = safeResult.outputs;
      if (safeOutputs && typeof safeOutputs === 'object' && run.result.outputs) {
        for (const [name, value] of Object.entries(run.result.outputs)) {
          if (value && typeof value === 'object' && !Array.isArray(value) && typeof (value as Record<string, unknown>).amount === 'string') {
            const output = (safeOutputs as Record<string, unknown>)[name];
            if (output && typeof output === 'object' && !Array.isArray(output)) (output as Record<string, unknown>).amount = (value as Record<string, unknown>).amount;
          }
        }
      }
    }
    return safe;
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
      const matcher = new CapabilityMatcher(learned ? [learned.intentSignature] : []);
    const match = learned ? matcher.match(goal) : { kind: 'miss' as const };
    if (match.kind === 'clarification' || match.kind === 'ambiguous') {
      const result: RunResult = { status: 'failed', error: { code: 'CLARIFICATION_REQUIRED', message: match.kind === 'clarification' ? match.message : 'More than one workflow matches this request.' } };
      store.updateRun(runId, { status: 'failed', result, llmCalls: 0, mode: 'clarification' });
      appendResultEvent(store, runId, result, 0);
      await persistRun(runId).catch(() => undefined);
      leases.delete(runId);
      return { runId, llmCalls: 0, mode: 'clarification' };
    }
    if (match.kind === 'match' && learned) {
      const replayRunner = new ReplayRunner(surface, policy, lease, async (reason, stepId, screenshot) => store.openIntervention(runId, reason, stepId, screenshot.path).id, (event: RunEvent) => store.appendEvent(runId, event));
      const replay = await replayRunner.run(learned, target, match.slots);
      if (replayRunner.lastSession) sessions.set(runId, replayRunner.lastSession);
      if (replay.status === 'needs_human') replayRunners.set(runId, replayRunner);
      store.updateRun(runId, { status: statusFor(replay), result: replay, capabilityId: learned.capabilityId, ...(replayRunner.lastSession ? { sessionId: replayRunner.lastSession.id } : {}), llmCalls: 0, mode: 'replay', events: replayRunner.events });
      appendResultEvent(store, runId, replay, 0);
      if (replay.status !== 'needs_human') await persistRun(runId).catch(() => undefined);
      if (replay.status !== 'needs_human' && replayRunner.lastSession) {
        await surface.close(replayRunner.lastSession);
        sessions.delete(runId);
      }
      return { runId, llmCalls: 0, mode: 'replay' };
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
    const discoveryRunner = new DiscoveryRunner(surface, counted, policy, lease, { maxActions: 32, onHuman: async (reason, stepId, screenshot) => store.openIntervention(runId, reason, stepId, screenshot.path).id, onEvent: (event: RunEvent) => store.appendEvent(runId, event) });
    discoveryRunners.set(runId, discoveryRunner);
    const discovery = await discoveryRunner.run(intent, target);
    if (discovery.runResult.status === 'succeeded' && discovery.artifact) {
      learned = discovery.artifact;
    }
    sessions.set(runId, discovery.session);
    llmCallCounts.set(runId, llmCalls);
    store.updateRun(runId, { status: statusFor(discovery.runResult), result: discovery.runResult, ...(discovery.artifact ? { capabilityId: discovery.artifact.capabilityId } : {}), sessionId: discovery.session.id, events: discovery.events, llmCalls, mode: 'discovery' });
    appendResultEvent(store, runId, discovery.runResult, llmCalls);
    if (discovery.runResult.status === 'succeeded' && discovery.artifact) {
      await persistArtifact(discovery.artifact);
    }
    if (discovery.runResult.status !== 'needs_human') await persistRun(runId).catch(() => undefined);
    if (discovery.runResult.status !== 'needs_human') {
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
  app.get('/api/workflows', async () => learned ? [learned] : []);
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
      lease.resume('human');
      await surface.setHumanActionSink?.(session, undefined);
      const runner = discoveryRunners.get(intervention.runId);
      const replayRunner = replayRunners.get(intervention.runId);
      if (!runner && !replayRunner) return reply.code(409).send({ error: 'continuation_not_available' });
      store.updateIntervention(intervention.id, 'resumed');
      if (runner) {
        const resumed = await runner.resume();
        if (resumed.runResult.status === 'succeeded' && resumed.artifact) {
          learned = resumed.artifact;
          await persistArtifact(resumed.artifact);
        }
        store.updateRun(intervention.runId, { status: statusFor(resumed.runResult), result: resumed.runResult, ...(resumed.artifact ? { capabilityId: resumed.artifact.capabilityId } : {}), events: resumed.events, sessionId: session.id, llmCalls: llmCallCounts.get(intervention.runId) ?? 0 });
        if (resumed.runResult.status !== 'needs_human') discoveryRunners.delete(intervention.runId);
        if (resumed.runResult.status !== 'needs_human') { replayRunners.delete(intervention.runId); }

      } else {
        const resumed = await replayRunner!.resume();
        const replayEvents = (replayRunner as ReplayRunner & { events?: RunEvent[] }).events;
        store.updateRun(intervention.runId, { status: statusFor(resumed), result: resumed, sessionId: session.id, ...(replayEvents ? { events: replayEvents } : {}) });
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

function statusFor(result: RunResult): 'succeeded' | 'business_outcome' | 'needs_human' | 'failed' { return result.status; }
function appendResultEvent(store: InMemoryRunStore, runId: string, result: RunResult, llmCalls: number): void {
  const existing = store.getRun(runId)?.events.some((event) => event.kind === 'result' && event.stepId === 'result' && event.outcome === result.status);
  if (existing) return;
  store.appendEvent(runId, { runId, stepId: 'result', kind: 'result', outcome: result.status, details: { llmCalls }, evidence: [] });
}
