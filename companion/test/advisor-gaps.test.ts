import { describe, expect, it } from 'vitest';
import { DiscoveryRunner } from '../src/discovery/runner.js';
import { ControlLease } from '../src/handoff/lease.js';
import { PolicyGate } from '../src/policy/gate.js';
import { createCompanion } from '../src/app/server.js';
import { ScriptedDiscoveryModel } from '../src/llm/client.js';
import type { ActionResult, SessionHandle, SurfaceAdapter, SurfaceSnapshot, TargetProfile } from '../src/surface/adapter.js';

class IframePolicySurface implements SurfaceAdapter {
  acts = 0;

  async start(_target: TargetProfile): Promise<SessionHandle> { return { id: 'iframe-policy' }; }
  async observe(_session: SessionHandle): Promise<SurfaceSnapshot> {
    return {
      url: 'http://localhost:3001/', title: 'outer', framePath: [], controls: [], visibleText: 'ready', dialogs: [], stateFingerprint: 'ready'
    };
  }
  async resolve(): Promise<{ count: number; description: string; resolvedControl: { role: string; name: string; framePath: string[]; frameUrl: string } }> {
    return {
      count: 1,
      description: 'unique target',
      resolvedControl: { role: 'button', name: 'Search', framePath: ['title:Member Servicing Area'], frameUrl: 'http://localhost:3001/servicing/member-search' }
    };
  }
  async act(_session: SessionHandle, _action: never): Promise<ActionResult> { this.acts += 1; return { status: 'succeeded' }; }
  async extract(): Promise<unknown> { return undefined; }
  async captureEvidence(): Promise<{ path: string; url: string }> { return { path: 'evidence.png', url: '/evidence.png' }; }
  async bringToHuman(): Promise<void> {}
  async close(): Promise<void> {}
}

class HandoffSurface implements SurfaceAdapter {
  bringCount = 0;
  private sink: ((action: { kind: string; details?: Record<string, unknown> }) => void | Promise<void>) | undefined;
  private readonly session: SessionHandle = { id: 'handoff-session' };

  async start(): Promise<SessionHandle> { return this.session; }
  async observe(): Promise<SurfaceSnapshot> { return { url: 'http://localhost:3001/', title: 'Demo', framePath: [], controls: [], visibleText: 'ready', dialogs: [], stateFingerprint: 'ready' }; }
  async resolve(): Promise<{ count: number; description: string }> { return { count: 1, description: 'unique' }; }
  async act(): Promise<ActionResult> { return { status: 'succeeded' }; }
  async extract(): Promise<unknown> { return undefined; }
  async captureEvidence(): Promise<{ path: string; url: string }> { return { path: 'handoff.png', url: '/handoff.png' }; }
  async bringToHuman(): Promise<void> { this.bringCount += 1; }
  async close(): Promise<void> {}
  async setHumanActionSink(_session: SessionHandle, sink: ((action: { kind: string; details?: Record<string, unknown> }) => void | Promise<void>) | undefined): Promise<void> { this.sink = sink; }
  async emit(action: { kind: string; details?: Record<string, unknown> }): Promise<void> { await this.sink?.(action); }
}

describe('advisor policy gaps', () => {
  it('derives risky policy from resolved target metadata instead of trusting declared read-only risk', () => {
    const gate = new PolicyGate({
      allowedOrigins: ['http://localhost:3001'], allowedRoutes: ['/servicing*'], allowedActionKinds: ['click'], maxRisk: 'READ_ONLY', controlOwner: 'automation',
      blockedTargetNamePatterns: ['Post Fee']
    });
    expect(gate.check({ kind: 'click', risk: 'READ_ONLY' }, new URL('http://localhost:3001/servicing/member/12345/accounts'), 'automation', { role: 'button', name: 'Post Fee', framePath: [], frameUrl: 'http://localhost:3001/servicing/member/12345/accounts' })).toEqual({ allowed: false, reason: 'risk_exceeds_policy' });
    expect(gate.check({ kind: 'click', risk: 'READ_ONLY' }, new URL('http://localhost:3001/servicing/member/12345/accounts'), 'automation', { role: 'link', name: 'Accounts', framePath: [], frameUrl: 'http://localhost:3001/servicing/member/12345/accounts' })).toEqual({ allowed: true });
  });

  it('blocks an iframe target using its resolved frame URL before acting', async () => {
    const surface = new IframePolicySurface();
    const runner = new DiscoveryRunner(
      surface,
      { decide: async () => ({ kind: 'click', id: 'search', target: { strategies: [{ text: 'Search' }] }, risk: 'READ_ONLY' as const }) },
      new PolicyGate({ allowedOrigins: ['http://localhost:3001'], allowedRoutes: ['/'], allowedActionKinds: ['click'], maxRisk: 'READ_ONLY', controlOwner: 'automation' }),
      new ControlLease(),
      { maxActions: 1 }
    );

    const result = await runner.run({ objective: 'lookup_member_savings_balance', entities: [], requestedOutputs: [], risk: 'read_only', userGoal: 'lookup' }, { id: 'demo', applicationFamily: 'demo', url: 'http://localhost:3001' });

    expect(result.runResult).toMatchObject({ status: 'failed', error: { code: 'POLICY_VIOLATION', message: 'route_not_allowed' } });
    expect(surface.acts).toBe(0);
  });

  it('does not bring the target forward until the human claims an intervention', async () => {
    const surface = new HandoffSurface();
    const app = await createCompanion({
      surface,
      discoveryModel: new ScriptedDiscoveryModel([{ kind: 'requestHuman', id: 'verify', reason: 'Supervisor verification required' }])
    });
    const created = JSON.parse((await app.inject({ method: 'POST', url: '/api/tasks', payload: { goal: 'Look up member 12345 and tell me their savings balance.' } })).body) as { runId: string };
    const paused = JSON.parse((await app.inject(`/api/runs/${created.runId}`)).body) as { interventionId: string };
    expect(surface.bringCount).toBe(0);
    await app.inject({ method: 'POST', url: `/api/interventions/${paused.interventionId}/claim` });
    expect(surface.bringCount).toBe(1);
    await app.close();
  });

  it('records page events only while the claimed human owns the session', async () => {
    const surface = new HandoffSurface();
    const app = await createCompanion({
      surface,
      discoveryModel: new ScriptedDiscoveryModel([
        { kind: 'requestHuman', id: 'verify', reason: 'Supervisor verification required' },
        { kind: 'finish', id: 'done', outputs: [], checkpoint: 'ready' }
      ])
    });
    const created = JSON.parse((await app.inject({ method: 'POST', url: '/api/tasks', payload: { goal: 'Look up member 12345 and tell me their savings balance.' } })).body) as { runId: string };
    const paused = JSON.parse((await app.inject(`/api/runs/${created.runId}`)).body) as { interventionId: string };
    await surface.emit({ kind: 'click', details: { text: 'before 12345' } });
    await app.inject({ method: 'POST', url: `/api/interventions/${paused.interventionId}/claim` });
    await surface.emit({ kind: 'click', details: { text: 'during 12345' } });
    let events = JSON.parse((await app.inject(`/api/runs/${created.runId}/events`)).body) as Array<{ kind: string }>;
    expect(events.filter((event) => event.kind === 'human_action')).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain('12345');
    await app.inject({ method: 'POST', url: `/api/interventions/${paused.interventionId}/resume` });
    await surface.emit({ kind: 'click', details: { text: 'after 12345' } });
    events = JSON.parse((await app.inject(`/api/runs/${created.runId}/events`)).body) as Array<{ kind: string }>;
    expect(events.filter((event) => event.kind === 'human_action')).toHaveLength(1);
    await app.close();
  });
});