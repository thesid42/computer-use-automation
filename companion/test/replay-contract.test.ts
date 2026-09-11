import { describe, expect, it } from 'vitest';
import { compileCapability } from '../src/artifact/compiler.js';
import { interpretGoal } from '../src/goal/interpret.js';
import { ControlLease } from '../src/handoff/lease.js';
import { PolicyGate } from '../src/policy/gate.js';
import { ReplayRunner } from '../src/replay/runner.js';
import type { ActionResult, SessionHandle, SurfaceAdapter, SurfaceSnapshot, TargetProfile } from '../src/surface/adapter.js';

class ContractSurface implements SurfaceAdapter {
  constructor(private readonly brokenEvidence = false) {}
  async start(): Promise<SessionHandle> { return { id: 'contract-session' }; }
  async observe(): Promise<SurfaceSnapshot> { return { url: 'http://localhost:3001/', title: 'Demo', framePath: [], controls: [], visibleText: 'Current Balance', dialogs: [], stateFingerprint: 'stable' }; }
  async resolve(): Promise<{ count: number; description: string }> { return { count: 1, description: 'unique' }; }
  async act(_session: SessionHandle, _action: never): Promise<ActionResult> { return { status: 'succeeded' }; }
  async extract(): Promise<unknown> { return { amount: 1250.42, currency: 'USD' }; }
  async captureEvidence(): Promise<{ path: string; url: string }> { if (this.brokenEvidence) throw new Error('capture_failed'); return { path: 'contract.png', url: '/contract.png' }; }
  async bringToHuman(): Promise<void> {}
  async close(): Promise<void> {}
}

const intent = interpretGoal('Look up member 12345 and tell me their savings balance.');
const base = compileCapability(intent, []);
const target: TargetProfile = { id: 'demo-app', applicationFamily: 'legacy-member-servicing', url: 'http://localhost:3001' };

function runner(surface: SurfaceAdapter, onEvent?: (event: unknown) => void): ReplayRunner {
  return new ReplayRunner(surface, new PolicyGate(base.policyProfile), new ControlLease(), undefined, onEvent);
}

describe('replay contract', () => {
  it('requires every declared output at the final checkpoint', async () => {
    const artifact = { ...base, actions: base.actions.map((action) => action.kind === 'extract' ? { ...action, output: 'other' } : action) };
    const result = await runner(new ContractSurface()).run(artifact, target, { member_id: '12345' });
    expect(result).toMatchObject({ status: 'failed', error: { code: 'OUTPUT_PARSE_FAILURE' } });
  });

  it('captures failure evidence without replacing the original failure', async () => {
    const artifact = { ...base, finalCheckpoint: 'A checkpoint that is absent', postconditions: ['A checkpoint that is absent'] };
    const events: unknown[] = [];
    const result = await runner(new ContractSurface(true), (event) => events.push(event)).run(artifact, target, { member_id: '12345' });
    expect(result).toMatchObject({ status: 'failed', error: { code: 'CHECKPOINT_MISMATCH' } });
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ outcome: 'failed:CHECKPOINT_MISMATCH', evidence: [] })]));
  });

  it('emits redacted action evidence while replaying with no model dependency', async () => {
    const events: unknown[] = [];
    const result = await runner(new ContractSurface(), (event) => events.push(event)).run(base, target, { member_id: '12345' });
    expect(result.status).toBe('succeeded');
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'action', evidence: ['contract.png'] })]));
    expect(JSON.stringify(events)).not.toContain('12345');
  });
});
