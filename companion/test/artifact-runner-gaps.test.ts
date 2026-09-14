import { describe, expect, it } from 'vitest';
import { compileCapability } from '../src/artifact/compiler.js';
import { interpretGoal } from '../src/goal/interpret.js';
import { DiscoveryRunner } from '../src/discovery/runner.js';
import { ControlLease } from '../src/handoff/lease.js';
import { PolicyGate } from '../src/policy/gate.js';
import { ReplayRunner } from '../src/replay/runner.js';
import type { ActionResult, SessionHandle, SurfaceAdapter, SurfaceSnapshot, TargetProfile } from '../src/surface/adapter.js';
import type { RunEvent } from '../src/evidence/events.js';
import { observedArtifact } from './helpers/fixtures.js';

const intent = interpretGoal('Look up member 12345 and tell me their savings balance.');

class GroundingSurface implements SurfaceAdapter {
  readonly filled: unknown[] = [];
  readonly selected: unknown[] = [];
  constructor(private text = 'ready', private firstResult?: ActionResult) {}
  setText(text: string): void { this.text = text; }
  async start(): Promise<SessionHandle> { return { id: 'grounding' }; }
  async observe(): Promise<SurfaceSnapshot> { return { url: 'http://localhost:3001/servicing/member-search', title: 'Demo', framePath: [], controls: [], visibleText: this.text, dialogs: [], stateFingerprint: this.text }; }
  async resolve(): Promise<{ count: number; description: string; resolvedControl: { role: string; framePath: string[] } }> { return { count: 1, description: 'unique', resolvedControl: { role: 'textbox', framePath: [] } }; }
  async act(_session: SessionHandle, action: { kind: string; value?: unknown; option?: unknown }): Promise<ActionResult> { if (action.kind === 'fill') this.filled.push(action.value); if (action.kind === 'selectOption') this.selected.push(action.option); if (this.firstResult) { const result = this.firstResult; this.firstResult = undefined; return result; } return { status: 'succeeded' }; }
  async extract(): Promise<unknown> { return { amount: '1250.42', currency: 'USD' }; }
  async captureEvidence(): Promise<{ path: string; url: string }> { return { path: 'evidence.png', url: '/evidence.png' }; }
  async bringToHuman(): Promise<void> {}
  async close(): Promise<void> {}
}

it('grounds fromInput before surface act while retaining the reference in the artifact', async () => {
  const surface = new GroundingSurface();
  const runner = new DiscoveryRunner(surface, { decide: async (_snapshot, _intent, events) => events.length === 0
    ? { kind: 'fill', id: 'fill-member', target: { strategies: [{ label: 'Member ID' }] }, value: { fromInput: 'member_id' }, risk: 'READ_ONLY' }
    : events.length === 1
      ? { kind: 'extract', id: 'extract-balance', target: { strategies: [{ label: 'Balance' }] }, output: 'current_savings_balance', parseAs: 'money' }
      : { kind: 'finish', id: 'done', outputs: ['current_savings_balance'], checkpoint: 'ready' } }, new PolicyGate({ allowedOrigins: ['http://localhost:3001'], allowedRoutes: ['/servicing*'], allowedActionKinds: ['fill', 'extract', 'finish'], maxRisk: 'READ_ONLY', controlOwner: 'automation' }), new ControlLease(), { maxActions: 3 });
  const result = await runner.run(intent, { id: 'demo', applicationFamily: 'legacy-member-servicing', url: 'http://localhost:3001' });
  expect(surface.filled).toEqual(['12345']);
  expect(result.artifact?.actions.find((action) => action.kind === 'fill')).toMatchObject({ value: { fromInput: 'member_id' } });
});

it('canonicalizes an input value reference for fill and select actions', async () => {
  const branchIntent = {
    objective: 'lookup_branch_directory',
    entities: [{ proposedName: 'item_query', value: 'Northside', sourceSpan: 'Northside', type: 'string' as const, sensitivity: 'plain' }],
    requestedOutputs: [{ proposedName: 'branch_directory', type: 'string' as const }], risk: 'read_only' as const, userGoal: 'Show the branch directory for Northside.'
  };
  const surface = new GroundingSurface();
  const runner = new DiscoveryRunner(surface, { decide: async (_snapshot, _intent, events) => events.length === 0
    ? { kind: 'fill', id: 'fill-branch', target: { strategies: [{ label: 'Branch' }] }, value: { fromInput: 'Northside' }, risk: 'READ_ONLY' }
    : events.length === 1
      ? { kind: 'selectOption', id: 'select-branch', target: { strategies: [{ label: 'Branch type' }] }, option: { fromInput: 'Northside' }, risk: 'READ_ONLY' }
      : events.length === 2
        ? { kind: 'extract', id: 'extract-branch', target: { strategies: [{ label: 'Branch results' }] }, output: 'branch_directory', parseAs: 'string' }
        : { kind: 'finish', id: 'done', outputs: ['branch_directory'], checkpoint: 'ready' } }, new PolicyGate({ allowedOrigins: ['http://localhost:3001'], allowedRoutes: ['/servicing*'], allowedActionKinds: ['fill', 'selectOption', 'extract', 'finish'], maxRisk: 'READ_ONLY', controlOwner: 'automation' }), new ControlLease(), { maxActions: 5 });
  const result = await runner.run(branchIntent, { id: 'demo', applicationFamily: 'legacy-member-servicing', url: 'http://localhost:3001' });
  expect(result.runResult.status).toBe('succeeded');
  expect(surface.filled).toEqual(['Northside']);
  expect(surface.selected).toEqual(['Northside']);
  expect(result.artifact?.actions.filter((action) => action.kind === 'fill' || action.kind === 'selectOption')).toMatchObject([
    { value: { fromInput: 'item_query' } },
    { option: { fromInput: 'item_query' } }
  ]);
});

it('fails explicitly for unknown or ambiguous input references without inventing a value', async () => {
  const makeRunner = (value: unknown, entities = [{ proposedName: 'item_query', value: 'Northside', sourceSpan: 'Northside', type: 'string' as const, sensitivity: 'plain' }]) => {
    const surface = new GroundingSurface();
    const runner = new DiscoveryRunner(surface, { decide: async () => ({ kind: 'fill', id: 'fill-branch', target: { strategies: [{ label: 'Branch' }] }, value, risk: 'READ_ONLY' }) }, new PolicyGate({ allowedOrigins: ['http://localhost:3001'], allowedRoutes: ['/servicing*'], allowedActionKinds: ['fill'], maxRisk: 'READ_ONLY', controlOwner: 'automation' }), new ControlLease(), { maxActions: 1 });
    return { surface, runner, entities };
  };
  const unknown = makeRunner({ fromInput: 'Southside' });
  const unknownResult = await unknown.runner.run({ objective: 'lookup_branch_directory', entities: unknown.entities, requestedOutputs: [], risk: 'read_only', userGoal: 'Show branches.' }, { id: 'demo', applicationFamily: 'legacy-member-servicing', url: 'http://localhost:3001' });
  expect(unknownResult.runResult).toMatchObject({ status: 'failed', error: { code: 'MODEL_ACTION_INVALID', message: 'unknown_input_reference:Southside' } });
  expect(unknown.surface.filled).toEqual([]);

  const ambiguous = makeRunner({ fromInput: 'Northside' }, [
    { proposedName: 'branch_name', value: 'Northside', sourceSpan: 'Northside', type: 'string', sensitivity: 'plain' },
    { proposedName: 'item_query', value: 'Northside', sourceSpan: 'Northside', type: 'string', sensitivity: 'plain' }
  ]);
  const ambiguousResult = await ambiguous.runner.run({ objective: 'lookup_branch_directory', entities: ambiguous.entities, requestedOutputs: [], risk: 'read_only', userGoal: 'Show branches.' }, { id: 'demo', applicationFamily: 'legacy-member-servicing', url: 'http://localhost:3001' });
  expect(ambiguousResult.runResult).toMatchObject({ status: 'failed', error: { code: 'MODEL_ACTION_INVALID', message: 'ambiguous_input_reference:Northside' } });
  expect(ambiguous.surface.filled).toEqual([]);
});

it('compiles only the ordered successful actions and resolved persistent targets from events', () => {
  const events: RunEvent[] = [
    { runId: 'run', stepId: 'custom-click', kind: 'action', action: { kind: 'click', id: 'custom-click', target: { strategies: [{ ref: 'control-9-0-1' }] }, risk: 'READ_ONLY' }, resolvedControl: { role: 'button', name: 'Custom', text: 'Custom', framePath: ['title:Member Servicing Area'] }, outcome: 'succeeded', evidence: [] },
    { runId: 'run', stepId: 'fill-id', kind: 'action', action: { kind: 'fill', id: 'fill-id', target: { strategies: [{ ref: 'control-9-1-2' }] }, value: '12345', risk: 'READ_ONLY' }, resolvedControl: { role: 'textbox', label: 'Member ID', framePath: ['title:Member Servicing Area'] }, outcome: 'succeeded', evidence: [] },
    { runId: 'run', stepId: 'wait-ready', kind: 'action', action: { kind: 'wait', id: 'wait-ready', condition: 'text:ready', timeoutMs: 1000 }, outcome: 'succeeded', evidence: [] },
    { runId: 'run', stepId: 'extract-balance', kind: 'action', action: { kind: 'extract', id: 'extract-balance', target: { strategies: [{ text: 'Current Balance' }] }, output: 'current_savings_balance', parseAs: 'money' }, outcome: 'succeeded', evidence: [] },
    { runId: 'run', stepId: 'finish', kind: 'action', action: { kind: 'finish', id: 'finish', outputs: ['current_savings_balance'], checkpoint: 'ready' }, outcome: 'succeeded', evidence: [] }
  ];
  const artifact = compileCapability(intent, events);
  expect(artifact.actions.map((action) => action.id)).toEqual(['custom-click', 'fill-id', 'wait-ready', 'extract-balance', 'finish']);
  expect(JSON.stringify(artifact)).not.toContain('control-9-');
  expect(artifact.actions[0]).toMatchObject({ target: { strategies: [{ role: 'button', name: 'Custom', framePath: ['title:Member Servicing Area'] }] } });
  expect(artifact.actions[1]).toMatchObject({ value: { fromInput: 'member_id' } });
  expect(JSON.stringify(artifact)).not.toContain('12345');
});

it('persists stable branch targets and canonical action ids without the observed query value', () => {
  const branchIntent = {
    objective: 'find_branches',
    entities: [{ proposedName: 'branch_query', value: 'Northside', sourceSpan: 'Northside', type: 'string' as const, sensitivity: 'plain' }],
    requestedOutputs: [{ proposedName: 'results', type: 'string' as const }],
    risk: 'read_only' as const,
    userGoal: 'Find branches matching Northside.',
    title: 'Find NorthSIDE branches',
    requiredConcepts: ['NorthSIDE lookup', 'branch'],
    phrases: ['Find branches matching NorthSIDE']
  };
  const frameUrl = 'http://127.0.0.1:3001/servicing/branch-directory?city=Northside#results';
  const artifact = compileCapability(branchIntent, [
    { runId: 'run', stepId: 'open-directory', kind: 'action', action: { kind: 'click', id: 'click-Northside', target: { strategies: [{ ref: 'control-1' }] }, risk: 'READ_ONLY' }, resolvedControl: { role: 'link', name: 'Branch Directory', text: 'Branch Directory', framePath: [], frameUrl }, outcome: 'succeeded', evidence: [] },
    { runId: 'run', stepId: 'fill-query', kind: 'action', action: { kind: 'fill', id: 'fill-NORTHside', target: { strategies: [{ ref: 'control-2' }] }, value: 'Northside', risk: 'READ_ONLY' }, resolvedControl: { role: 'textbox', name: 'City or branch', label: 'City or branch', framePath: [], frameUrl }, outcome: 'succeeded', evidence: [] },
    { runId: 'run', stepId: 'find-branches', kind: 'action', action: { kind: 'click', id: 'click-NORTHSIDE', target: { strategies: [{ ref: 'control-3' }] }, risk: 'READ_ONLY' }, resolvedControl: { role: 'button', name: 'Find Branches', text: 'Find Branches', framePath: [], frameUrl }, outcome: 'succeeded', evidence: [] },
    { runId: 'run', stepId: 'extract-results', kind: 'action', action: { kind: 'extract', id: 'extract-results', target: { strategies: [{ ref: 'control-4' }] }, output: 'results', parseAs: 'string' }, resolvedControl: { role: 'table', name: 'Branch directory', text: 'Branch directory Code Branch Address Hours Phone 07 NorthSIDE 250 North Avenue', framePath: [], frameUrl }, outcome: 'succeeded', evidence: [] },
    { runId: 'run', stepId: 'finish', kind: 'action', action: { kind: 'finish', id: 'branch-query-NORTHside-results', outputs: ['results'], checkpoint: 'Branch directory' }, outcome: 'succeeded', evidence: [] }
  ]);
  const serialized = JSON.stringify(artifact);
  expect(serialized).not.toMatch(/northside/i);
  expect(new Set(artifact.actions.map((action) => action.id)).size).toBe(artifact.actions.length);
  expect(artifact.actions.filter((action) => action.kind === 'click').map((action) => action.id)).toEqual(['click-branch_query', 'click-branch_query-2']);
  expect(artifact.actions.find((action) => action.kind === 'finish')?.id).toBe('branch-query-branch_query-results');
  const extraction = artifact.actions.find((action) => action.kind === 'extract');
  expect(extraction).toMatchObject({ target: { strategies: [{ role: 'table', name: 'Branch directory', framePath: [], frameUrl: 'http://127.0.0.1:3001/servicing/branch-directory' }] } });
  expect(extraction && extraction.kind === 'extract' ? extraction.target.strategies[0] : undefined).not.toHaveProperty('text');
  expect(artifact.intentSignature.phrases).toEqual(['Find branches matching {branch_query}']);
});

it('persists a definition-list value relationship and removes duplicate action events', () => {
  const extractEvent = (stepId: string): RunEvent => ({
    runId: 'run', stepId, kind: 'action',
    action: { kind: 'extract', id: 'extract-balance', target: { strategies: [{ ref: 'control-2-0-1' }] }, output: 'current_savings_balance', parseAs: 'money' },
    resolvedControl: { role: 'definition', name: '$1,250.42', text: '$1,250.42', relativeText: 'Current Balance', framePath: ['title:Member Servicing Area'] },
    outcome: 'succeeded', evidence: [], details: { output: 'current_savings_balance' }
  });
  const artifact = compileCapability(intent, [
    extractEvent('extract-1'),
    extractEvent('extract-2'),
    { runId: 'run', stepId: 'finish', kind: 'action', action: { kind: 'finish', id: 'finish', outputs: ['current_savings_balance'], checkpoint: 'Current Balance visible' }, outcome: 'succeeded', evidence: [] }
  ]);
  expect(artifact.actions.filter((action) => action.id === 'extract-balance')).toHaveLength(1);
  expect(artifact.actions.find((action) => action.id === 'extract-balance')).toEqual(expect.objectContaining({ target: { strategies: [{ relativeText: 'Current Balance', framePath: ['title:Member Servicing Area'] }] } }));
});

it('returns business outcomes discovered in visible text before asking the model to act', async () => {
  const surface = new GroundingSurface('MEMBER_NOT_FOUND');
  const runner = new DiscoveryRunner(surface, { decide: async () => ({ kind: 'finish', id: 'done', outputs: [], checkpoint: 'ready' }) }, new PolicyGate({ allowedOrigins: ['http://localhost:3001'], allowedRoutes: ['/servicing*'], allowedActionKinds: ['finish'], maxRisk: 'READ_ONLY', controlOwner: 'automation' }), new ControlLease(), { maxActions: 1 });
  const result = await runner.run(intent, { id: 'demo', applicationFamily: 'legacy-member-servicing', url: 'http://localhost:3001' });
  expect(result.runResult).toEqual({ status: 'business_outcome', code: 'MEMBER_NOT_FOUND' });
  expect(result.artifact).toBeUndefined();
});

it('retries a temporary discovery action within the bounded retry count', async () => {
  const surface = new GroundingSurface('ready', { status: 'recoverable', code: 'TEMPORARY_LOAD_FAILURE', message: 'try again' });
  const runner = new DiscoveryRunner(surface, { decide: async (_snapshot, _intent, events) => events.length === 0
    ? ({ kind: 'click', id: 'go', target: { strategies: [{ role: 'button', name: 'Search' }] }, risk: 'READ_ONLY' })
    : events.some((event) => event.action && typeof event.action === 'object' && (event.action as { kind?: string }).kind === 'extract')
      ? ({ kind: 'finish', id: 'done', outputs: ['current_savings_balance'], checkpoint: 'ready' })
      : ({ kind: 'extract', id: 'extract-balance', target: { strategies: [{ text: 'Current Balance' }] }, output: 'current_savings_balance', parseAs: 'money' }) }, new PolicyGate({ allowedOrigins: ['http://localhost:3001'], allowedRoutes: ['/servicing*'], allowedActionKinds: ['click', 'extract', 'finish'], maxRisk: 'READ_ONLY', controlOwner: 'automation' }), new ControlLease(), { maxActions: 3, retries: 1 });
  const result = await runner.run(intent, { id: 'demo', applicationFamily: 'legacy-member-servicing', url: 'http://localhost:3001' });
  expect(result.runResult.status).toBe('succeeded');
});

it('preserves exact decimal money strings during deterministic replay', async () => {
  const surface = new GroundingSurface('Current Balance');
  const artifact = observedArtifact(intent);
  const result = await new ReplayRunner(surface, new PolicyGate(artifact.policyProfile), new ControlLease()).run(artifact, { id: 'demo', applicationFamily: 'legacy-member-servicing', url: 'http://localhost:3001' }, { member_id: '12345' });
  expect(result).toMatchObject({ status: 'succeeded', outputs: { current_savings_balance: { amount: '1250.42', currency: 'USD' } } });
});

it('resumes a paused replay on the original session and executes the remaining actions', async () => {
  const surface = new GroundingSurface('SUPERVISOR_VERIFICATION_REQUIRED');
  const artifact = observedArtifact(intent);
  const runner = new ReplayRunner(surface, new PolicyGate(artifact.policyProfile), new ControlLease(), async () => {
    surface.setText('Current Balance');
    return 'intervention-replay';
  });
  const first = await runner.run(artifact, { id: 'demo', applicationFamily: 'legacy-member-servicing', url: 'http://localhost:3001' }, { member_id: '12345' });
  expect(first.status).toBe('needs_human');
  const resumed = await runner.resume();
  expect(resumed).toMatchObject({ status: 'succeeded', checkpointVerified: true });
});

it('derives artifact checkpoint and postconditions from the successful finish event', () => {
  const artifact = compileCapability(intent, [{
    runId: 'run', stepId: 'extract', kind: 'action',
    action: { kind: 'extract', id: 'extract', target: { strategies: [{ text: 'Current Balance' }] }, output: 'current_savings_balance', parseAs: 'money' }, outcome: 'succeeded', evidence: []
  }, {
    runId: 'run', stepId: 'finish', kind: 'action',
    action: { kind: 'finish', id: 'finish', outputs: ['current_savings_balance'], checkpoint: 'Savings balance ready' },
    outcome: 'succeeded', evidence: []
  }]);
  expect(artifact.finalCheckpoint).toBe('Savings balance ready');
  expect(artifact.postconditions).toEqual(['Savings balance ready']);
});

it('rejects a successful finish without an observed output extraction', () => {
  expect(() => compileCapability(intent, [{
    runId: 'run', stepId: 'finish', kind: 'action',
    action: { kind: 'finish', id: 'finish', outputs: [], checkpoint: 'Savings balance ready' },
    outcome: 'succeeded', evidence: []
  }])).toThrow(/no observed extraction/);
});

it('rejects a fill literal that was not grounded by the exact intent entity', () => {
  expect(() => compileCapability(intent, [
    { runId: 'run', stepId: 'grounded', kind: 'action', action: { kind: 'fill', id: 'grounded', target: { strategies: [{ label: 'Member ID' }] }, value: '12345', risk: 'READ_ONLY' }, outcome: 'succeeded', evidence: [] },
    { runId: 'run', stepId: 'constant', kind: 'action', action: { kind: 'fill', id: 'constant', target: { strategies: [{ label: 'Member ID' }] }, value: '12346', risk: 'READ_ONLY' }, outcome: 'succeeded', evidence: [] },
    { runId: 'run', stepId: 'finish', kind: 'action', action: { kind: 'finish', id: 'finish', outputs: [], checkpoint: 'ready' }, outcome: 'succeeded', evidence: [] }
  ])).toThrow(/not grounded/);
});
