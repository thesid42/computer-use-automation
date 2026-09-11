import { describe, expect, it } from 'vitest';
import { interpretGoal } from '../src/goal/interpret.js';
import { PolicyGate } from '../src/policy/gate.js';
import { ControlLease } from '../src/handoff/lease.js';
import { DiscoveryRunner, type DiscoveryModel } from '../src/discovery/runner.js';
import type { ActionResult, SessionHandle, SurfaceAdapter, SurfaceSnapshot, TargetProfile } from '../src/surface/adapter.js';

class ScriptedModel implements DiscoveryModel {
  calls = 0;
  constructor(private readonly decisions: Array<Record<string, unknown>>) {}
  async decide(): Promise<Record<string, unknown>> { const decision = this.decisions[this.calls++]; if (!decision) throw new Error('script_exhausted'); return decision; }
}
class RepairingModel implements DiscoveryModel {
  repairs = 0;
  constructor(private readonly initial: Record<string, unknown>, private readonly corrected: Record<string, unknown> | Array<Record<string, unknown>>) {}
  async decide(): Promise<Record<string, unknown>> { return this.initial; }
  async repair(_snapshot: SurfaceSnapshot, _intent: Parameters<NonNullable<DiscoveryModel['repair']>>[1], _events: unknown[], context: { validationError: string; attempt: number }): Promise<Record<string, unknown>> {
    this.repairs += 1;
    expect(context.validationError).toContain('target');
    if (!Array.isArray(this.corrected)) return this.corrected;
    const correction = this.corrected[this.repairs - 1] ?? this.corrected[this.corrected.length - 1];
    if (!correction) throw new Error('repair_script_exhausted');
    return correction;
  }
}
class DiscoverySurface implements SurfaceAdapter {
  async start(): Promise<SessionHandle> { return { id: 'discovery-session' }; }
  async observe(): Promise<SurfaceSnapshot> { return { url: 'http://localhost:3001/member-search', title: 'Demo', framePath: [], controls: [{ ref: 'search', role: 'button', name: 'Search', framePath: [] }], visibleText: 'Current Balance', dialogs: [], stateFingerprint: 'state' }; }
  async resolve(): Promise<{ count: number; description: string }> { return { count: 1, description: 'unique' }; }
  async act(_session: SessionHandle, _action: { kind: string }): Promise<ActionResult> { return { status: 'succeeded' }; }
  async extract(): Promise<unknown> { return { amount: 1250.42, currency: 'USD' }; }
  async captureEvidence(): Promise<{ path: string; url: string }> { return { path: 'latest.png', url: '/latest.png' }; }
  async bringToHuman(): Promise<void> {}
  async close(): Promise<void> {}
}

describe('discovery loop', () => {
  it('observes, validates, acts, records verified events, and compiles an artifact', async () => {
    const model = new ScriptedModel([
      { kind: 'click', id: 'go', target: { strategies: [{ role: 'button', name: 'Search' }] }, risk: 'READ_ONLY' },
      { kind: 'extract', id: 'balance', target: { strategies: [{ text: 'Current Balance' }] }, output: 'current_savings_balance', parseAs: 'money' },
      { kind: 'finish', id: 'done', outputs: ['current_savings_balance'], checkpoint: 'Current Balance visible' }
    ]);
    const policy = new PolicyGate({ allowedOrigins: ['http://localhost:3001'], allowedRoutes: ['/member-search'], allowedActionKinds: ['click', 'extract', 'finish'], maxRisk: 'READ_ONLY', controlOwner: 'automation' });
    const result = await new DiscoveryRunner(new DiscoverySurface(), model, policy, new ControlLease(), { maxActions: 5 }).run(
      interpretGoal('Look up member 12345 and tell me their savings balance.'), { id: 'demo-app', applicationFamily: 'legacy-member-servicing', url: 'http://localhost:3001' }
    );
    expect(result.runResult).toEqual({ status: 'succeeded', outputs: { current_savings_balance: { amount: 1250.42, currency: 'USD' } }, checkpointVerified: true });
    expect(result.events).toHaveLength(3);
    expect(result.artifact?.intentSignature.intent).toBe('lookup_member_savings_balance');
    expect(JSON.stringify(result.artifact)).not.toContain('12345');
    expect(model.calls).toBe(3);
  });

  it('makes one bounded repair call and only acts after the repaired action validates', async () => {
    const model = new RepairingModel(
      { kind: 'click', id: 'go' },
      { kind: 'finish', id: 'done', outputs: [], checkpoint: 'Current Balance visible' }
    );
    const policy = new PolicyGate({ allowedOrigins: ['http://localhost:3001'], allowedRoutes: ['/member-search'], allowedActionKinds: ['click', 'finish'], maxRisk: 'READ_ONLY', controlOwner: 'automation' });
    const result = await new DiscoveryRunner(new DiscoverySurface(), model, policy, new ControlLease(), { maxActions: 2 }).run(
      interpretGoal('Look up member 12345 and tell me their savings balance.'), { id: 'demo-app', applicationFamily: 'legacy-member-servicing', url: 'http://localhost:3001' }
    );
    expect(result.runResult).toMatchObject({ status: 'succeeded' });
    expect(model.repairs).toBe(1);
    expect(result.events.some((event) => event.outcome === 'model_action_repair_requested')).toBe(true);
    expect(result.events.some((event) => event.kind === 'action')).toBe(true);
  });

  it('fails after one invalid repair without touching the surface', async () => {
    const model = new RepairingModel(
      { kind: 'click', id: 'click-secret', value: '12345' },
      { kind: 'click', id: 'click-secret', value: '12345' }
    );
    const policy = new PolicyGate({ allowedOrigins: ['http://localhost:3001'], allowedRoutes: ['/member-search'], allowedActionKinds: ['click'], maxRisk: 'READ_ONLY', controlOwner: 'automation' });
    const result = await new DiscoveryRunner(new DiscoverySurface(), model, policy, new ControlLease(), { maxActions: 2 }).run(
      interpretGoal('Look up member 12345 and tell me their savings balance.'), { id: 'demo-app', applicationFamily: 'legacy-member-servicing', url: 'http://localhost:3001' }
    );
    expect(result.runResult).toMatchObject({ status: 'failed', error: { code: 'MODEL_ACTION_INVALID' } });
    expect(model.repairs).toBe(2);
    expect(result.events.filter((event) => event.kind === 'action')).toHaveLength(0);
    const diagnostic = result.events.find((event) => event.outcome === 'model_action_repair_requested');
    expect(JSON.stringify(diagnostic)).not.toContain('12345');
  });

  it('uses the second repair attempt when the first correction is still invalid', async () => {
    const model = new RepairingModel(
      { kind: 'click', id: 'go' },
      [
        { kind: 'click', id: 'still-missing-target', target: {} },
        { kind: 'finish', id: 'done', outputs: [], checkpoint: 'Current Balance visible' }
      ]
    );
    const policy = new PolicyGate({ allowedOrigins: ['http://localhost:3001'], allowedRoutes: ['/member-search'], allowedActionKinds: ['click', 'finish'], maxRisk: 'READ_ONLY', controlOwner: 'automation' });
    const result = await new DiscoveryRunner(new DiscoverySurface(), model, policy, new ControlLease(), { maxActions: 2 }).run(
      interpretGoal('Look up member 12345 and tell me their savings balance.'), { id: 'demo-app', applicationFamily: 'legacy-member-servicing', url: 'http://localhost:3001' }
    );
    expect(result.runResult).toMatchObject({ status: 'succeeded' });
    expect(model.repairs).toBe(2);
    expect(result.events.filter((event) => event.outcome === 'model_action_repair_requested')).toHaveLength(2);
  });
});
