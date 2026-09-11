import { describe, expect, it } from 'vitest';
import { PolicyGate } from '../src/policy/gate.js';
import { InMemoryRunStore } from '../src/domain/store.js';
import { ControlLease } from '../src/handoff/lease.js';

describe('policy gate', () => {
  const gate = new PolicyGate({
    allowedOrigins: ['http://localhost:3001'], allowedRoutes: ['/member-search'],
    allowedActionKinds: ['click', 'fill', 'wait'], maxRisk: 'READ_ONLY', controlOwner: 'automation'
  });

  it('denies a risky action before it can reach the surface', () => {
    const decision = gate.check({ kind: 'click', risk: 'IRREVERSIBLE_WRITE' }, new URL('http://localhost:3001/member-search'), 'automation');
    expect(decision).toEqual({ allowed: false, reason: 'risk_exceeds_policy' });
  });

  it('denies an origin and route outside the configured allowlist', () => {
    expect(gate.check({ kind: 'click', risk: 'READ_ONLY' }, new URL('https://evil.example/member-search'), 'automation').allowed).toBe(false);
    expect(gate.check({ kind: 'click', risk: 'READ_ONLY' }, new URL('http://localhost:3001/admin'), 'automation').allowed).toBe(false);
  });
});

describe('control lease and run store', () => {
  it('enforces human claim, resume, and abort state transitions', () => {
    const lease = new ControlLease();
    expect(lease.owner).toBe('automation');
    lease.claim('human');
    expect(() => lease.assertAutomation()).toThrow('human');
    lease.resume('human');
    expect(lease.owner).toBe('automation');
    lease.abort();
    expect(() => lease.claim('human')).toThrow('aborted');
  });

  it('stores a run and intervention in memory', () => {
    const store = new InMemoryRunStore();
    const run = store.createRun('Look up member 12345');
    const intervention = store.openIntervention(run.id, 'Supervisor verification required', 'step-1', 'evidence/run.png');
    expect(store.getRun(run.id)?.id).toBe(run.id);
    expect(store.getIntervention(intervention.id)).toMatchObject({ runId: run.id, status: 'open' });
  });
});
