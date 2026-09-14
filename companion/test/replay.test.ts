import { describe, expect, it } from 'vitest';
import { compileCapability } from '../src/artifact/compiler.js';
import { interpretGoal } from '../src/goal/interpret.js';
import { PolicyGate } from '../src/policy/gate.js';
import { ControlLease } from '../src/handoff/lease.js';
import { ReplayRunner } from '../src/replay/runner.js';
import type { ActionResult, SessionHandle, SurfaceAdapter, SurfaceSnapshot, TargetProfile } from '../src/surface/adapter.js';
import { observedArtifact } from './helpers/fixtures.js';

type Mode = 'success' | 'not-found' | 'transient' | 'snapshot-transient' | 'ambiguous-recovery' | 'stuck-recovery';
class FakeSurface implements SurfaceAdapter {
  readonly calls: string[] = [];
  readonly waits: string[] = [];
  attempts = 0;
  recoveryCount = 0;
  private transientVisible = false;
  constructor(private readonly mode: Mode) {}
  async start(_target: TargetProfile): Promise<SessionHandle> { return { id: 'session-1' }; }
  async observe(_session: SessionHandle): Promise<SurfaceSnapshot> { return { url: 'http://localhost:3001/servicing/member-search', title: 'Demo', framePath: [], controls: this.transientVisible ? [{ ref: 'retry-control', role: 'button', name: 'Retry Search', framePath: [] }, ...(this.mode === 'ambiguous-recovery' ? [{ ref: 'retry-control-2', role: 'button', name: 'Try Again', framePath: [] }] : [])] : [], visibleText: this.transientVisible ? 'TEMPORARY_LOAD_FAILURE Retry Search' : 'Current Balance', dialogs: [], stateFingerprint: this.transientVisible ? 'transient' : 'stable' }; }
  async resolve(_session: SessionHandle, _target: unknown): Promise<{ count: number; description: string }> { return { count: 1, description: 'matched' }; }
  async act(_session: SessionHandle, action: { kind: string; condition?: string }): Promise<ActionResult> {
    this.calls.push(action.kind);
    if (action.kind === 'wait' && action.condition) this.waits.push(action.condition);
    if (action.kind === 'wait' && this.transientVisible) { this.transientVisible = false; this.recoveryCount += 1; return { status: 'succeeded' }; }
    if (action.kind === 'click' && this.transientVisible) { if (this.mode !== 'stuck-recovery') this.transientVisible = false; this.recoveryCount += 1; return { status: 'succeeded' }; }
    if (action.kind === 'click' && this.mode === 'not-found') return { status: 'business_outcome', code: 'MEMBER_NOT_FOUND' };
    if (action.kind === 'click' && this.mode === 'transient' && this.attempts++ === 0) return { status: 'recoverable', message: 'slow response' };
    if (action.kind === 'click' && (this.mode === 'snapshot-transient' || this.mode === 'stuck-recovery' || this.mode === 'ambiguous-recovery') && !this.transientVisible) this.transientVisible = true;
    return { status: 'succeeded' };
  }
  async extract(): Promise<unknown> { return { amount: '1250.42', currency: 'USD' }; }
  async captureEvidence(): Promise<{ path: string; url: string }> { return { path: 'evidence/screenshot.png', url: '/evidence/screenshot.png' }; }
  async bringToHuman(): Promise<void> {}
  async close(): Promise<void> {}
}

const artifact = observedArtifact(interpretGoal('Look up member 12345 and tell me their savings balance.'));
const profile: TargetProfile = { id: 'demo-app', applicationFamily: 'legacy-member-servicing', url: 'http://localhost:3001' };
const gate = new PolicyGate(artifact.policyProfile);

describe('deterministic replay', () => {
  it('returns typed success and performs zero model calls', async () => {
    const surface = new FakeSurface('success');
    const result = await new ReplayRunner(surface, gate, new ControlLease()).run(artifact, profile, { member_id: '12345' });
    expect(result).toEqual({ status: 'succeeded', outputs: { current_savings_balance: { amount: '1250.42', currency: 'USD' } }, checkpointVerified: true });
    expect(surface.calls.length).toBeGreaterThan(0);
    expect(surface.waits).toContain('text:Member Search Results');
  });

  it('returns a declared business outcome instead of throwing', async () => {
    const result = await new ReplayRunner(new FakeSurface('not-found'), gate, new ControlLease()).run(artifact, profile, { member_id: '99999' });
    expect(result).toMatchObject({ status: 'business_outcome', code: 'MEMBER_NOT_FOUND' });
  });

  it('retries one recoverable action within the artifact bound', async () => {
    const surface = new FakeSurface('transient');
    const result = await new ReplayRunner(surface, gate, new ControlLease()).run(artifact, profile, { member_id: '12345' });
    expect(result.status).toBe('succeeded');
    expect(surface.attempts).toBe(6);
  });

  it('recovers a temporary state observed between replay steps before resolving the next target', async () => {
    const surface = new FakeSurface('snapshot-transient');
    const result = await new ReplayRunner(surface, gate, new ControlLease()).run(artifact, profile, { member_id: '12345' });
    expect(result.status).toBe('succeeded');
    expect(surface.recoveryCount).toBeGreaterThan(0);
  });

  it('fails when a temporary page exposes ambiguous retry controls', async () => {
    const result = await new ReplayRunner(new FakeSurface('ambiguous-recovery'), gate, new ControlLease()).run(artifact, profile, { member_id: '12345' });
    expect(result).toMatchObject({ status: 'failed', error: { code: 'RECOVERABLE_EXHAUSTED', message: 'retry_control_ambiguous' } });
  });

  it('honors the recovery retry bound when the visible retry control remains temporary', async () => {
    const surface = new FakeSurface('stuck-recovery');
    const result = await new ReplayRunner(surface, gate, new ControlLease()).run(artifact, profile, { member_id: '12345' });
    expect(result).toMatchObject({ status: 'failed', error: { code: 'RECOVERABLE_EXHAUSTED' } });
    expect(surface.recoveryCount).toBe(artifact.waits.retries + 1);
  });
});
