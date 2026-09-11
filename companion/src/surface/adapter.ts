import type { ArtifactAction, CapabilityArtifact, TargetSpec } from '../artifact/schema.js';
import { capabilitySchema } from '../artifact/schema.js';
import type { RunResult } from '../domain/types.js';
import { ControlLease } from '../handoff/lease.js';
import { PolicyGate } from '../policy/gate.js';
import { RunEventRecorder, type RunEvent, type RunEventSink } from '../evidence/events.js';

export type TargetProfile = { id: string; applicationFamily: string; url: string; headless?: boolean };
export type SessionHandle = { id: string; page?: unknown };
export type SurfaceControl = { ref: string; role: string; name?: string; text?: string; label?: string; relativeText?: string; framePath: string[]; frameUrl?: string };
export type ResolvedControl = Omit<SurfaceControl, 'ref'> & { ref?: string };
export type SurfaceSnapshot = {
  screenshot?: string;
  url: string;
  title: string;
  framePath: string[];
  controls: SurfaceControl[];
  visibleText: string;
  dialogs: string[];
  stateFingerprint: string;
};
export type Resolution = { count: number; description: string; resolvedControl?: ResolvedControl };
export type ActionResult =
  | { status: 'succeeded'; details?: Record<string, unknown> }
  | { status: 'recoverable'; message: string; code?: 'TEMPORARY_LOAD_FAILURE' }
  | { status: 'business_outcome'; code: string; details?: Record<string, unknown> }
  | { status: 'needs_human'; reason: string; code?: 'SUPERVISOR_VERIFICATION_REQUIRED' }
  | { status: 'failed'; message: string };
export type HumanActionSink = (action: { kind: string; details?: Record<string, unknown> }) => void | Promise<void>;

export interface SurfaceAdapter {
  start(target: TargetProfile): Promise<SessionHandle>;
  observe(session: SessionHandle): Promise<SurfaceSnapshot>;
  act(session: SessionHandle, action: ArtifactAction): Promise<ActionResult>;
  resolve(session: SessionHandle, target: TargetSpec): Promise<Resolution>;
  extract(session: SessionHandle, spec: { target: TargetSpec; parseAs: 'text' | 'money' | 'string' }): Promise<unknown>;
  captureEvidence(session: SessionHandle): Promise<{ path: string; url: string }>;
  bringToHuman(session: SessionHandle): Promise<void>;
  close(session: SessionHandle): Promise<void>;
  setHumanActionSink?(session: SessionHandle, sink: HumanActionSink | undefined): Promise<void>;
  /** Drain browser-to-host human events queued by a fire-and-forget page bridge. */
  flushHumanActionEvents?(session: SessionHandle): Promise<void>;
}

export function inputValue(value: string | { fromInput: string }, inputs: Record<string, string>): string {
  if (typeof value === 'string') return value;
  const resolved = inputs[value.fromInput];
  if (resolved === undefined) throw new Error(`missing_input:${value.fromInput}`);
  return resolved;
}

function outcomeFromSnapshot(snapshot: SurfaceSnapshot): ActionResult | undefined {
  const text = snapshot.visibleText;
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
  if (text.includes('TEMPORARY_LOAD_FAILURE')) return { status: 'recoverable', code: 'TEMPORARY_LOAD_FAILURE', message: 'Temporary load failure is visible' };
  if (text.includes('SUPERVISOR_VERIFICATION_REQUIRED')) return { status: 'needs_human', code: 'SUPERVISOR_VERIFICATION_REQUIRED', reason: 'Supervisor verification is required' };
  return undefined;
}

function decimalMoney(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (typeof record.amount !== 'number') return value;
  return { ...record, amount: record.amount.toFixed(2) };
}

export class ReplayRunner {
  lastSession?: SessionHandle;
  readonly events: RunEvent[] = [];
  private continuation: (() => Promise<RunResult>) | undefined;
  private pausedSession?: SessionHandle;
  private recorder!: RunEventRecorder;

  constructor(
    private readonly surface: SurfaceAdapter,
    private readonly policy: PolicyGate,
    private readonly lease: ControlLease,
    private readonly onHuman?: (reason: string, stepId: string, screenshot: { path: string; url: string }) => Promise<string>,
    private readonly onEvent?: RunEventSink
  ) {
  }

  async run(rawArtifact: CapabilityArtifact, target: TargetProfile, inputs: Record<string, string>, existingSession?: SessionHandle): Promise<RunResult> {
    const artifact = capabilitySchema.parse(rawArtifact);
    const declaredInputs = new Set(artifact.inputs.map((input) => input.name));
    for (const name of Object.keys(inputs)) {
      if (!declaredInputs.has(name)) return { status: 'failed', error: { code: 'INVALID_INVOCATION', message: `Unknown input: ${name}` } };
    }
    for (const input of artifact.inputs) {
      const value = inputs[input.name];
      if (typeof value !== 'string' || value.length < input.validation.minLength || value.length > input.validation.maxLength || ((input.validation.format === 'iso_date' || input.sensitivity === 'date') && !isIsoDate(value))) {
        return { status: 'failed', error: { code: 'INVALID_INVOCATION', message: `Invalid input: ${input.name}` } };
      }
    }
    const session = existingSession ?? await this.surface.start(target);
    this.lastSession = session;
    this.pausedSession = session;
    this.recorder = new RunEventRecorder((event) => {
      this.events.push(event);
      return this.onEvent?.(event);
    });
    this.events.length = 0;
    const result = await this.execute(artifact, target, inputs, session, {}, 0);
    if (result.status !== 'needs_human') this.continuation = undefined;
    return result;
  }

  async resume(): Promise<RunResult> {
    const continuation = this.continuation;
    const session = this.pausedSession;
    if (!continuation || !session) throw new Error('no_replay_continuation');
    this.continuation = undefined;
    await this.surface.observe(session);
    const result = await continuation();
    if (result.status !== 'needs_human') this.continuation = undefined;
    return result;
  }

  private async execute(artifact: CapabilityArtifact, target: TargetProfile, inputs: Record<string, string>, session: SessionHandle, outputs: Record<string, unknown>, startIndex: number): Promise<RunResult> {
    const recorder = this.recorder;
    try {
      const targetUrl = new URL(target.url);
      for (const condition of artifact.preconditions) {
        if (/^target is on an allowed origin$/i.test(condition)) {
          if (!this.policy.isOriginAllowed(targetUrl)) return await this.failureResult(recorder, session, 'PRECONDITION_FAILED', condition);
        } else if (/^automation owns the session$/i.test(condition)) {
          this.lease.assertAutomation();
        } else {
          return await this.failureResult(recorder, session, 'UNSUPPORTED_PRECONDITION', condition);
        }
      }
      for (let index = startIndex; index < artifact.actions.length; index += 1) {
        const action = artifact.actions[index];
        if (!action) break;
        this.lease.assertAutomation();
        let snapshot: SurfaceSnapshot;
        try {
          snapshot = await this.surface.observe(session);
        } catch (error) {
          return await this.failureResult(recorder, session, 'BROWSER_FAILURE', error instanceof Error ? error.message : String(error), action.id);
        }
        let visibleOutcome = outcomeFromSnapshot(snapshot);
        if (visibleOutcome?.status === 'recoverable') {
          let recovery: ActionResult = visibleOutcome;
          for (let attempt = 0; attempt <= artifact.waits.retries; attempt += 1) {
            // Temporary errors in the legacy surface expose a visible Retry
            // Search button. Recover through that browser control so replay
            // remains UI-only and deterministic; retain a bounded wait when a
            // compatible surface has no retry affordance.
            const retryTarget: TargetSpec = { strategies: [{ role: 'button', name: 'Retry Search' }, { text: 'Retry Search' }] };
            const retryResolution = await this.surface.resolve(session, retryTarget);
            const recoveryAction: ArtifactAction = retryResolution.count === 1
              ? { kind: 'click', id: `recover-${action.id}`, target: retryTarget, risk: 'READ_ONLY' }
              : { kind: 'wait', id: `recover-${action.id}`, condition: 'text:TEMPORARY_LOAD_FAILURE', timeoutMs: artifact.waits.defaultTimeoutMs };
            const recoveryDecision = this.policy.check({ kind: recoveryAction.kind, risk: 'READ_ONLY', ...(retryResolution.resolvedControl ? { target: retryResolution.resolvedControl } : {}) }, new URL(retryResolution.resolvedControl?.frameUrl ?? snapshot.url), 'automation', retryResolution.resolvedControl);
            if (!recoveryDecision.allowed) return await this.failureResult(recorder, session, 'POLICY_VIOLATION', recoveryDecision.reason, recoveryAction.id, snapshot.stateFingerprint, recoveryAction);
            recovery = await this.surface.act(session, recoveryAction);
            const afterRecovery = await this.safeObserve(session, snapshot);
            const observedRecoveryOutcome = outcomeFromSnapshot(afterRecovery);
            // A click can return while the browser is still committing its
            // navigation, so act() may report the old TEMPORARY marker even
            // though the fresh observation is already the recovered page.
            // Trust the fresh visible state for this bounded recovery step.
            if (recovery.status === 'recoverable' && !observedRecoveryOutcome) recovery = { status: 'succeeded' };
            else if (recovery.status === 'recoverable' && observedRecoveryOutcome?.status === 'business_outcome') recovery = observedRecoveryOutcome;
            const recoveryEvidence = await this.captureEvidence(session);
            recorder.record({ runId: session.id, stepId: recoveryAction.id, kind: 'action', action: recoveryAction, outcome: recovery.status, beforeFingerprint: snapshot.stateFingerprint, afterFingerprint: afterRecovery.stateFingerprint, evidence: recoveryEvidence });
            if (recovery.status !== 'recoverable') break;
            snapshot = afterRecovery;
          }
          if (recovery.status === 'business_outcome') return recovery;
          if (recovery.status === 'needs_human') return this.pauseForHuman(session, recovery.reason, action.id, index, artifact, target, inputs, outputs, recorder);
          if (recovery.status !== 'succeeded') {
            return await this.failureResult(recorder, session, 'RECOVERABLE_EXHAUSTED', recovery.message, action.id, snapshot.stateFingerprint);
          }
          snapshot = await this.surface.observe(session);
          visibleOutcome = outcomeFromSnapshot(snapshot);
        }
        if (visibleOutcome?.status === 'business_outcome') {
          await this.recordOutcome(recorder, session, action.id, visibleOutcome);
          return visibleOutcome;
        }
        if (visibleOutcome?.status === 'needs_human') return this.pauseForHuman(session, visibleOutcome.reason, action.id, index, artifact, target, inputs, outputs, recorder);
        let resolvedControl: ResolvedControl | undefined;
        if ('target' in action) {
          const resolution = await this.surface.resolve(session, action.target);
          if (resolution.count !== 1) return await this.failureResult(recorder, session, resolution.count === 0 ? 'TARGET_MISSING' : 'TARGET_AMBIGUOUS', resolution.description, action.id, snapshot.stateFingerprint, action);
          resolvedControl = resolution.resolvedControl;
        }
        const decision = this.policy.check(
          { kind: action.kind, risk: 'risk' in action ? action.risk : 'READ_ONLY', ...(resolvedControl ? { target: resolvedControl } : {}) },
          new URL(resolvedControl?.frameUrl ?? snapshot.url),
          'automation',
          resolvedControl
        );
        if (!decision.allowed) return await this.failureResult(recorder, session, 'POLICY_VIOLATION', decision.reason, action.id, snapshot.stateFingerprint, action, resolvedControl);
        if (action.kind === 'finish') {
          if (action.checkpoint !== artifact.finalCheckpoint) return await this.failureResult(recorder, session, 'CHECKPOINT_MISMATCH', 'Finish action does not match artifact final checkpoint', action.id, snapshot.stateFingerprint, action);
          if (!conditionVisible(snapshot.visibleText, artifact.finalCheckpoint)) return await this.failureResult(recorder, session, 'CHECKPOINT_MISMATCH', 'Final checkpoint was not visible', action.id, snapshot.stateFingerprint, action, undefined, artifact.finalCheckpoint);
          for (const condition of artifact.postconditions) {
            const verified = verifyPostcondition(condition, snapshot, artifact.finalCheckpoint, this.policy, this.lease);
            if (verified === undefined) return await this.failureResult(recorder, session, 'UNSUPPORTED_POSTCONDITION', condition, action.id, snapshot.stateFingerprint, action);
            if (!verified) return await this.failureResult(recorder, session, 'POSTCONDITION_FAILED', condition, action.id, snapshot.stateFingerprint, action);
          }
          const outputError = validateOutputs(artifact, outputs, action.outputs);
          if (outputError) return await this.failureResult(recorder, session, 'OUTPUT_PARSE_FAILURE', outputError, action.id, snapshot.stateFingerprint, action);
          const evidence = await this.captureEvidence(session);
          recorder.record({ runId: session.id, stepId: action.id, kind: 'action', action, outcome: 'succeeded', beforeFingerprint: snapshot.stateFingerprint, afterFingerprint: snapshot.stateFingerprint, evidence });
          return { status: 'succeeded', outputs, checkpointVerified: true };
        }
        if (action.kind === 'extract') {
          const extracted = await this.surface.extract(session, { target: action.target, parseAs: action.parseAs });
          outputs[action.output] = action.parseAs === 'money' ? decimalMoney(extracted) : extracted;
          const evidence = await this.captureEvidence(session);
          recorder.record({ runId: session.id, stepId: action.id, kind: 'action', action, outcome: 'succeeded', beforeFingerprint: snapshot.stateFingerprint, afterFingerprint: snapshot.stateFingerprint, evidence, details: { output: action.output } });
          continue;
        }
        if (action.kind === 'requestHuman') return this.pauseForHuman(session, action.reason, action.id, index, artifact, target, inputs, outputs, recorder);
        const prepared = action.kind === 'fill'
          ? { ...action, value: inputValue(action.value, inputs) }
          : action.kind === 'selectOption'
            ? { ...action, option: inputValue(action.option, inputs) }
            : action;
        let result: ActionResult = { status: 'failed', message: 'not executed' };
        for (let attempt = 0; attempt <= artifact.waits.retries; attempt += 1) {
          result = await this.surface.act(session, prepared);
          if (result.status !== 'recoverable') break;
        }
        const after = await this.safeObserve(session, snapshot);
        const evidence = await this.captureEvidence(session);
        recorder.record({ runId: session.id, stepId: action.id, kind: 'action', action, outcome: result.status, beforeFingerprint: snapshot.stateFingerprint, afterFingerprint: after.stateFingerprint, evidence, ...(result.status === 'business_outcome' ? { details: { code: result.code } } : {}) });
        if (result.status === 'business_outcome') return result;
        if (result.status === 'needs_human') return this.pauseForHuman(session, result.reason, action.id, index + 1, artifact, target, inputs, outputs, recorder);
        if (result.status !== 'succeeded') return await this.failureResult(recorder, session, result.status === 'recoverable' ? 'RECOVERABLE_EXHAUSTED' : 'SURFACE_FAILURE', result.message, action.id, after.stateFingerprint, action);
      }
      return await this.failureResult(recorder, session, 'FINAL_CHECKPOINT_MISSING', 'Artifact finished without a final checkpoint action');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return await this.failureResult(recorder, session, message.startsWith('lease_') || message.startsWith('control_') ? 'CONTROL_LEASE' : 'BROWSER_FAILURE', message);
    }
  }

  private async pauseForHuman(session: SessionHandle, reason: string, stepId: string, nextIndex: number, artifact: CapabilityArtifact, target: TargetProfile, inputs: Record<string, string>, outputs: Record<string, unknown>, recorder: RunEventRecorder): Promise<RunResult> {
    const screenshot = await this.captureScreenshot(session);
    recorder.record({ runId: session.id, stepId, kind: 'observation', outcome: 'needs_human', details: { reason }, evidence: screenshot ? [screenshot.path] : [] });
    const handoffScreenshot = screenshot ?? { path: '', url: '' };
    let interventionId: string;
    try { interventionId = this.onHuman ? await this.onHuman(reason, stepId, handoffScreenshot) : `intervention-${stepId}`; }
    catch { interventionId = `intervention-${stepId}`; }
    this.pausedSession = session;
    this.continuation = () => this.execute(artifact, target, inputs, session, outputs, nextIndex);
    return { status: 'needs_human', interventionId, reason, stepId };
  }

  private async safeObserve(session: SessionHandle, fallback: SurfaceSnapshot): Promise<SurfaceSnapshot> {
    try { return await this.surface.observe(session); } catch { return fallback; }
  }

  private async captureEvidence(session: SessionHandle): Promise<string[]> {
    const screenshot = await this.captureScreenshot(session);
    return screenshot ? [screenshot.path] : [];
  }

  private async captureScreenshot(session: SessionHandle): Promise<{ path: string; url: string } | undefined> {
    try { return await this.surface.captureEvidence(session); } catch { return undefined; }
  }

  private async recordOutcome(recorder: RunEventRecorder, session: SessionHandle, stepId: string, outcome: ActionResult): Promise<void> {
    recorder.record({ runId: session.id, stepId, kind: 'observation', outcome: outcome.status === 'business_outcome' ? outcome.code : outcome.status, evidence: await this.captureEvidence(session) });
  }

  private async failureResult(recorder: RunEventRecorder, session: SessionHandle, code: string, message: string, stepId?: string, observedState?: string, action?: unknown, resolvedControl?: ResolvedControl, expectedState?: string): Promise<RunResult> {
    const evidence = await this.captureEvidence(session);
    recorder.record({ runId: session.id, stepId: stepId ?? 'run', kind: action ? 'action' : 'result', ...(action ? { action, ...(resolvedControl ? { resolvedControl } : {}) } : {}), outcome: `failed:${code}`, evidence, ...(observedState ? { afterFingerprint: observedState } : {}), details: { code, message, ...(expectedState ? { expectedState } : {}) } });
    return { status: 'failed', error: { code, message, ...(stepId ? { stepId } : {}), ...(observedState ? { observedState } : {}), ...(expectedState ? { expectedState } : {}), ...(evidence[0] ? { evidenceRef: evidence[0] } : {}) } };
  }
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function conditionVisible(visibleText: string, condition: string): boolean {
  const expected = condition.replace(/\s+visible$/i, '').trim();
  return Boolean(expected) && visibleText.includes(expected);
}

function verifyPostcondition(condition: string, snapshot: SurfaceSnapshot, finalCheckpoint: string, policy: PolicyGate, lease: ControlLease): boolean | undefined {
  if (/^automation owns the session$/i.test(condition)) { try { lease.assertAutomation(); return true; } catch { return false; } }
  if (/^target is on an allowed origin$/i.test(condition)) { try { return policy.isOriginAllowed(new URL(snapshot.url)); } catch { return false; } }
  if (/\s+visible$/i.test(condition) || condition === finalCheckpoint) return conditionVisible(snapshot.visibleText, condition);
  return undefined;
}

function validateOutputs(artifact: CapabilityArtifact, outputs: Record<string, unknown>, declared: string[]): string | undefined {
  const declaredSet = new Set(declared);
  for (const output of artifact.outputs) {
    if (!declaredSet.has(output.name)) return `Finish action did not declare output: ${output.name}`;
    if (!(output.name in outputs)) return `Missing declared output: ${output.name}`;
    const value = outputs[output.name];
    if (output.type === 'string' && typeof value !== 'string') return `Output ${output.name} must be a string`;
    if (output.type === 'money') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return `Output ${output.name} must be money`;
      const money = value as Record<string, unknown>;
      if (typeof money.amount !== 'string' || !/^[-+]?\d+(?:\.\d+)?$/.test(money.amount)) return `Output ${output.name}.amount must be a decimal string`;
      if (output.currency && money.currency !== output.currency) return `Output ${output.name}.currency must be ${output.currency}`;
    }
  }
  return undefined;
}
