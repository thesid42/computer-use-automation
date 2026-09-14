import { actionSchema, type ArtifactAction, type CapabilityArtifact } from '../artifact/schema.js';
import { compileCapability } from '../artifact/compiler.js';
import type { ProvisionalIntent } from '../goal/interpret.js';
import { ControlLease } from '../handoff/lease.js';
import { RunEventRecorder, type RunEvent, type RunEventSink } from '../evidence/events.js';
import { PolicyGate } from '../policy/gate.js';
import type { RunResult } from '../domain/types.js';
import type { ActionResult, SessionHandle, SurfaceAdapter, SurfaceSnapshot, TargetProfile } from '../surface/adapter.js';

export interface DiscoveryModel {
  decide(snapshot: SurfaceSnapshot, intent: ProvisionalIntent, priorEvents: RunEvent[]): Promise<unknown>;
  /**
   * Give a model one bounded opportunity to repair an invalid action. The
   * repair receives the same grounded snapshot and the validation error; the
   * caller must validate the returned action before touching the surface.
   */
  repair?(snapshot: SurfaceSnapshot, intent: ProvisionalIntent, priorEvents: RunEvent[], context: { validationError: string; stepId: string; proposal: unknown; attempt: number }): Promise<unknown>;
}

export type DiscoveryResult = {
  runResult: RunResult;
  artifact?: CapabilityArtifact;
  events: RunEvent[];
  session: SessionHandle;
};

function visibleOutcome(text: string): ActionResult | undefined {
  if (text.includes('MEMBER_NOT_FOUND')) return { status: 'business_outcome', code: 'MEMBER_NOT_FOUND' };
  if (text.includes('PERMISSION_DENIED')) return { status: 'business_outcome', code: 'PERMISSION_DENIED' };
  if (text.includes('NO_TRANSACTIONS')) return { status: 'business_outcome', code: 'NO_TRANSACTIONS' };
  if (text.includes('UNSUPPORTED_AS_OF_DATE')) return { status: 'business_outcome', code: 'UNSUPPORTED_AS_OF_DATE' };
  if (text.includes('NO_LOAN')) return { status: 'business_outcome', code: 'NO_LOAN' };
  if (text.includes('INVALID_START_DATE')) return { status: 'business_outcome', code: 'INVALID_START_DATE' };
  if (text.includes('INVALID_END_DATE')) return { status: 'business_outcome', code: 'INVALID_END_DATE' };
  if (text.includes('INVALID_AS_OF_DATE')) return { status: 'business_outcome', code: 'INVALID_AS_OF_DATE' };
  if (text.includes('INVALID_DATE_RANGE')) return { status: 'business_outcome', code: 'INVALID_DATE_RANGE' };
  if (text.includes('INVALID_DATE')) return { status: 'business_outcome', code: 'INVALID_DATE' };
  if (text.includes('SUPERVISOR_VERIFICATION_REQUIRED')) return { status: 'needs_human', code: 'SUPERVISOR_VERIFICATION_REQUIRED', reason: 'Supervisor verification is required' };
  return undefined;
}

function groundedInputEntity(reference: string, intent: ProvisionalIntent): ProvisionalIntent['entities'][number] {
  const byName = intent.entities.filter((entity) => entity.proposedName === reference);
  if (byName.length === 1 && byName[0]) return byName[0];
  if (byName.length > 1) throw new Error(`ambiguous_input_reference:${reference}`);
  const byValue = intent.entities.filter((entity) => entity.value === reference);
  if (byValue.length === 1 && byValue[0]) return byValue[0];
  if (byValue.length > 1) throw new Error(`ambiguous_input_reference:${reference}`);
  throw new Error(`unknown_input_reference:${reference}`);
}

function canonicalInputName(reference: string, intent: ProvisionalIntent): string {
  return groundedInputEntity(reference, intent).proposedName;
}

function inputFromIntent(name: string, intent: ProvisionalIntent): string {
  return groundedInputEntity(name, intent).value;
}

function eventAction(action: ArtifactAction, intent: ProvisionalIntent): ArtifactAction {
  if (action.kind === 'fill' && typeof action.value === 'string') {
    const grounded = intent.entities.filter((entity) => entity.value === action.value || entity.proposedName === action.value);
    if (grounded.length > 1) throw new Error(`ambiguous_input_reference:${action.value}`);
    return grounded[0] ? { ...action, value: { fromInput: grounded[0].proposedName } } : action;
  }
  if (action.kind === 'selectOption' && typeof action.option === 'string') {
    const grounded = intent.entities.filter((entity) => entity.value === action.option || entity.proposedName === action.option);
    if (grounded.length > 1) throw new Error(`ambiguous_input_reference:${action.option}`);
    return grounded[0] ? { ...action, option: { fromInput: grounded[0].proposedName } } : action;
  }
  if (action.kind === 'fill' && typeof action.value !== 'string') {
    return { ...action, value: { fromInput: canonicalInputName(action.value.fromInput, intent) } };
  }
  if (action.kind === 'selectOption' && typeof action.option !== 'string') {
    return { ...action, option: { fromInput: canonicalInputName(action.option.fromInput, intent) } };
  }
  return action;
}

function normalizeModelAction(proposal: unknown, _snapshot: SurfaceSnapshot, intent: ProvisionalIntent): unknown {
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) return proposal;
  let value = { ...(proposal as Record<string, unknown>) };
  // Some OpenAI-compatible endpoints wrap the JSON action in one envelope. Unwrap
  // only a single object envelope and only when it does not already look like an action.
  for (const key of ['action', 'arguments', 'input']) {
    const nested = value[key];
    if (typeof value.kind !== 'string' && typeof value.type !== 'string' && nested && typeof nested === 'object' && !Array.isArray(nested)) {
      value = { ...(nested as Record<string, unknown>) };
    }
  }
  // A provider may serialize a response envelope with an escaped JSON key. If
  // exactly one nested object is already an action, unwrap that object without
  // interpreting arbitrary prose or guessing any missing fields.
  if (typeof value.kind !== 'string' && typeof value.type !== 'string') {
    const nestedActions = Object.values(value).filter((candidate): candidate is Record<string, unknown> => Boolean(candidate && typeof candidate === 'object' && !Array.isArray(candidate) && typeof (candidate as Record<string, unknown>).kind === 'string'));
    if (nestedActions.length === 1) value = { ...nestedActions[0] };
  }
  const actionKinds = ['click', 'fill', 'selectOption', 'wait', 'extract', 'finish', 'requestHuman', 'clickPoint'] as const;
  if (typeof value.kind !== 'string' && typeof value.type !== 'string') {
    const nestedKinds = actionKinds.filter((kind) => value[kind] && typeof value[kind] === 'object' && !Array.isArray(value[kind]));
    if (nestedKinds.length === 1 && nestedKinds[0]) {
      const kind = nestedKinds[0];
      value = { ...(value[kind] as Record<string, unknown>), kind };
    }
  }
  if (typeof value.type === 'string' && value.kind === undefined) value.kind = value.type;
  if (typeof value.kind !== 'string') return value;
  if (typeof value.id !== 'string') value.id = `${value.kind}-provider`;

  // A reasoning model occasionally emits {fill:{fromInput:"member_id"}} or
  // {kind:"fill",fromInput:"member_id"}. Preserve that explicit reference,
  // while rejecting proposals that omit the semantic value entirely.
  const fromInput = value.fromInput;
  if ((value.kind === 'fill' && value.value === undefined) || (value.kind === 'selectOption' && value.option === undefined)) {
    if (typeof fromInput === 'string') {
      value[value.kind === 'fill' ? 'value' : 'option'] = { fromInput: canonicalInputName(fromInput, intent) };
    }
  }
  delete value.fromInput;
  return value;
}

export class DiscoveryRunner {
  readonly events: RunEvent[] = [];
  lastSession?: SessionHandle;
  private continuation: (() => Promise<DiscoveryResult>) | undefined;
  private resumedSession?: SessionHandle;

  constructor(
    private readonly surface: SurfaceAdapter,
    private readonly model: DiscoveryModel,
    private readonly policy: PolicyGate,
    private readonly lease: ControlLease,
    private readonly options: { maxActions: number; retries?: number; maxElapsedMs?: number; maxNoProgress?: number; onHuman?: (reason: string, stepId: string, screenshot: { path: string; url: string }) => Promise<string>; onEvent?: RunEventSink }
  ) {}

  async run(intent: ProvisionalIntent, target: TargetProfile): Promise<DiscoveryResult> {
    const session = await this.surface.start(target);
    this.lastSession = session;
    this.resumedSession = session;
    this.events.length = 0;
    const recorder = new RunEventRecorder((event) => {
      this.events.push(event);
      return this.options.onEvent?.(event);
    });
    const outputs: Record<string, unknown> = {};
    const result = await this.execute(intent, target, session, recorder, outputs, 0, Date.now(), undefined, 0);
    if (result.runResult.status !== 'needs_human') this.continuation = undefined;
    return result;
  }

  async resume(): Promise<DiscoveryResult> {
    const continuation = this.continuation;
    const session = this.resumedSession;
    if (!continuation || !session) throw new Error('no_discovery_continuation');
    this.continuation = undefined;
    await this.surface.observe(session);
    const result = await continuation();
    if (result.runResult.status === 'needs_human') return result;
    this.continuation = undefined;
    return result;
  }

  private async execute(intent: ProvisionalIntent, target: TargetProfile, session: SessionHandle, recorder: RunEventRecorder, outputs: Record<string, unknown>, startCount: number, startedAt = Date.now(), priorFingerprint?: string, stagnantCount = 0): Promise<DiscoveryResult> {
    try {
      for (let count = startCount; count < this.options.maxActions; count += 1) {
        const maxElapsedMs = this.options.maxElapsedMs ?? 120_000;
        const maxNoProgress = this.options.maxNoProgress ?? Math.max(8, this.options.maxActions);
        if (Date.now() - startedAt >= maxElapsedMs || stagnantCount >= maxNoProgress) {
          return this.pauseForHuman(session, 'Discovery exceeded its time or progress bound. Review the current page and continue in this same session.', `guard-${count}`, count, intent, target, recorder, outputs);
        }
        this.lease.assertAutomation();
        const snapshot = await this.surface.observe(session);
        const nextStagnantCount = priorFingerprint !== undefined && priorFingerprint === snapshot.stateFingerprint ? stagnantCount + 1 : 0;
        const snapshotOutcome = visibleOutcome(snapshot.visibleText);
        if (snapshotOutcome?.status === 'business_outcome') return { runResult: snapshotOutcome, events: recorder.events, session };
        if (snapshotOutcome?.status === 'needs_human') {
          const evidence = await this.captureEvidence(session);
          const stepId = `observation-${count}`;
          const interventionId = this.options.onHuman ? await this.options.onHuman(snapshotOutcome.reason, stepId, evidence) : `intervention-${stepId}`;
          this.continuation = () => this.execute(intent, target, session, recorder, outputs, count + 1, Date.now(), undefined, 0);
          return { runResult: { status: 'needs_human', interventionId, reason: snapshotOutcome.reason, stepId }, events: recorder.events, session };
        }
        let action: ArtifactAction;
        let proposal: unknown;
        try {
          proposal = normalizeModelAction(await this.model.decide(snapshot, intent, recorder.events), snapshot, intent);
          let parsed = actionSchema.safeParse(proposal);
          // A provider gets at most two correction attempts for one step. Each
          // response is validated before anything can resolve or act on it.
          for (let attempt = 1; !parsed.success && this.model.repair && attempt <= 2; attempt += 1) {
            const validationError = parsed.error.message;
            // Keep malformed provider output in sanitized diagnostic events.
            // The repair model receives the validation error, the original
            // proposal, and the unchanged grounded snapshot for correction.
            recorder.record({
              runId: session.id,
              stepId: `model-repair-${count}-${attempt}`,
              kind: 'observation',
              outcome: 'model_action_repair_requested',
              evidence: [],
              details: { validationError, proposal, attempt }
            });
            proposal = normalizeModelAction(await this.model.repair(snapshot, intent, recorder.events, { validationError, stepId: `action-${count}`, proposal, attempt }), snapshot, intent);
            parsed = actionSchema.safeParse(proposal);
          }
          if (!parsed.success) throw new Error(parsed.error.message);
          action = eventAction(parsed.data, intent);
        } catch (error) {
          return await this.failureResult(recorder, session, 'MODEL_ACTION_INVALID', error instanceof Error ? error.message : String(error));
        }
        if (Date.now() - startedAt >= maxElapsedMs) {
          return this.pauseForHuman(session, 'Discovery exceeded its time bound while choosing the next action. Review the current page and continue in this same session.', `guard-${count}`, count, intent, target, recorder, outputs);
        }
        let resolvedControl: import('../surface/adapter.js').ResolvedControl | undefined;
        if ('target' in action) {
          const resolution = await this.surface.resolve(session, action.target);
          if (resolution.count !== 1) return await this.failureResult(recorder, session, resolution.count === 0 ? 'TARGET_MISSING' : 'TARGET_AMBIGUOUS', resolution.description, action.id);
          resolvedControl = resolution.resolvedControl;
        }
        const decision = this.policy.check(
          { kind: action.kind, risk: 'risk' in action ? action.risk : 'READ_ONLY', ...(resolvedControl ? { target: resolvedControl } : {}) },
          new URL(resolvedControl?.frameUrl ?? snapshot.url),
          'automation',
          resolvedControl
        );
        if (!decision.allowed) {
          recorder.record({ runId: session.id, stepId: action.id, kind: 'action', action: eventAction(action, intent), ...(resolvedControl ? { resolvedControl } : {}), outcome: `denied:${decision.reason}`, beforeFingerprint: snapshot.stateFingerprint, evidence: [] });
          return await this.failureResult(recorder, session, 'POLICY_VIOLATION', decision.reason, action.id);
        }
        if (action.kind === 'finish') {
          const checkpoint = action.checkpoint.replace(/\s+visible$/i, '');
          if (!snapshot.visibleText.includes(action.checkpoint) && !snapshot.visibleText.includes(checkpoint)) return await this.failureResult(recorder, session, 'CHECKPOINT_MISMATCH', action.checkpoint, action.id);
          const evidence = await this.captureEvidence(session);
          recorder.record({ runId: session.id, stepId: action.id, kind: 'action', action, outcome: 'succeeded', beforeFingerprint: snapshot.stateFingerprint, afterFingerprint: snapshot.stateFingerprint, evidence: evidence.path ? [evidence.path] : [] });
          try {
            const artifact = compileCapability(intent, recorder.events, target.id);
            return { runResult: { status: 'succeeded', outputs, checkpointVerified: true }, artifact, events: recorder.events, session };
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return await this.failureResult(recorder, session, 'CAPABILITY_COMPILE_INVALID', message, action.id);
          }
        }
        if (action.kind === 'requestHuman') {
          const evidence = await this.captureEvidence(session);
          const interventionId = this.options.onHuman ? await this.options.onHuman(action.reason, action.id, evidence) : `intervention-${action.id}`;
          recorder.record({ runId: session.id, stepId: action.id, kind: 'action', action, outcome: 'needs_human', evidence: evidence.path ? [evidence.path] : [] });
          this.continuation = () => this.execute(intent, target, session, recorder, outputs, count + 1, Date.now(), undefined, 0);
          return { runResult: { status: 'needs_human', interventionId, reason: action.reason, stepId: action.id }, events: recorder.events, session };
        }
        if (action.kind === 'extract') {
          outputs[action.output] = await this.surface.extract(session, { target: action.target, parseAs: action.parseAs });
          const evidence = await this.captureEvidence(session);
          recorder.record({ runId: session.id, stepId: action.id, kind: 'action', action: eventAction(action, intent), ...(resolvedControl ? { resolvedControl } : {}), outcome: 'succeeded', details: { output: action.output }, evidence: evidence.path ? [evidence.path] : [] });
          if (nextStagnantCount >= maxNoProgress) return this.pauseForHuman(session, 'Discovery made no observable progress. Review the current page and continue in this same session.', `guard-${count + 1}`, count + 1, intent, target, recorder, outputs);
          priorFingerprint = snapshot.stateFingerprint;
          stagnantCount = nextStagnantCount;
          continue;
        }
        const prepared = action.kind === 'fill'
          ? { ...action, value: typeof action.value === 'string' ? action.value : inputFromIntent(action.value.fromInput, intent) }
          : action.kind === 'selectOption'
            ? { ...action, option: typeof action.option === 'string' ? action.option : inputFromIntent(action.option.fromInput, intent) }
            : action;
        let result: ActionResult = { status: 'failed', message: 'not executed' };
        for (let attempt = 0; attempt <= (this.options.retries ?? 1); attempt += 1) {
          result = await this.surface.act(session, prepared);
          if (result.status !== 'recoverable') break;
        }
        const after = await this.surface.observe(session);
        const evidence = await this.captureEvidence(session);
        const event: RunEvent = { runId: session.id, stepId: action.id, kind: 'action', action: eventAction(action, intent), ...(resolvedControl ? { resolvedControl } : {}), outcome: result.status, beforeFingerprint: snapshot.stateFingerprint, afterFingerprint: after.stateFingerprint, evidence: evidence.path ? [evidence.path] : [] };
        if (result.status === 'business_outcome') event.details = { code: result.code };
        recorder.record(event);
        if (result.status === 'business_outcome') return { runResult: result, events: recorder.events, session };
        if (result.status === 'needs_human') {
          const interventionId = this.options.onHuman ? await this.options.onHuman(result.reason, action.id, evidence) : `intervention-${action.id}`;
          this.continuation = () => this.execute(intent, target, session, recorder, outputs, count + 1, Date.now(), undefined, 0);
          return { runResult: { status: 'needs_human', interventionId, reason: result.reason, stepId: action.id }, events: recorder.events, session };
        }
        if (result.status !== 'succeeded') return await this.failureResult(recorder, session, result.status === 'recoverable' ? 'RECOVERABLE_EXHAUSTED' : 'SURFACE_FAILURE', result.message, action.id);
        if (nextStagnantCount >= maxNoProgress) return this.pauseForHuman(session, 'Discovery made no observable progress. Review the current page and continue in this same session.', `guard-${count + 1}`, count + 1, intent, target, recorder, outputs);
        priorFingerprint = after.stateFingerprint;
        stagnantCount = nextStagnantCount;
      }
      return await this.failureResult(recorder, session, 'MAX_ACTIONS', 'Discovery action limit reached');
    } catch (error) {
      return await this.failureResult(recorder, session, 'DISCOVERY_FAILURE', error instanceof Error ? error.message : String(error));
    }
  }

  private async failureResult(recorder: RunEventRecorder, session: SessionHandle, code: string, message: string, stepId?: string): Promise<DiscoveryResult> {
    const error = stepId ? { code, message, stepId } : { code, message };
    let evidence: string[] = [];
    try { evidence = [(await this.surface.captureEvidence(session)).path]; } catch { /* preserve the original failure */ }
    recorder.record({ runId: session.id, stepId: stepId ?? 'run', kind: 'result', outcome: `failed:${code}`, evidence, details: { code, message } });
    return { runResult: { status: 'failed', error }, events: recorder.events, session };
  }

  private async pauseForHuman(session: SessionHandle, reason: string, stepId: string, nextCount: number, intent: ProvisionalIntent, target: TargetProfile, recorder: RunEventRecorder, outputs: Record<string, unknown>): Promise<DiscoveryResult> {
    const screenshot = await this.captureEvidence(session);
    recorder.record({ runId: session.id, stepId, kind: 'observation', outcome: 'needs_human', evidence: screenshot.path ? [screenshot.path] : [], details: { reason } });
    let interventionId = `intervention-${stepId}`;
    try { if (this.options.onHuman) interventionId = await this.options.onHuman(reason, stepId, screenshot); } catch { /* keep deterministic intervention id */ }
    this.continuation = () => this.execute(intent, target, session, recorder, outputs, nextCount, Date.now(), undefined, 0);
    return { runResult: { status: 'needs_human', interventionId, reason, stepId }, events: recorder.events, session };
  }

  private async captureEvidence(session: SessionHandle): Promise<{ path: string; url: string }> {
    try { return await this.surface.captureEvidence(session); } catch { return { path: '', url: '' }; }
  }
}
