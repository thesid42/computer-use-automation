import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCompanion } from '../src/app/server.js';
import { compileCapability } from '../src/artifact/compiler.js';
import { interpretGoal } from '../src/goal/interpret.js';
import { ScriptedDemoSurfaceAdapter } from '../src/surface/fake.js';
import { observedArtifact } from './helpers/fixtures.js';

describe('durable workflow library', () => {
  it('replays a stored family artifact directly without invoking the discovery model', async () => {
    const root = await mkdtemp(join(tmpdir(), 'companion-workflows-'));
    try {
      const artifact = observedArtifact(interpretGoal('Look up member 12345 and list transactions from 2026-09-01 to 2026-09-11.'));
      await mkdir(join(root, 'offline', 'artifacts'), { recursive: true });
      await writeFile(join(root, 'offline', 'artifacts', 'transactions.json'), JSON.stringify(artifact));
      let starts = 0;
      const surface = new ScriptedDemoSurfaceAdapter();
      const originalStart = surface.start.bind(surface);
      surface.start = async (...args) => { starts += 1; return originalStart(...args); };
      const app = await createCompanion({ offline: true, runtimeDir: root, surface, discoveryModel: { decide: async () => { throw new Error('discovery model must not run'); } } });
      const summaries = JSON.parse((await app.inject('/api/workflows')).body) as Array<{ id: string; inputs: Array<{ name: string }>; outputs: Array<{ name: string }>; runCount: number }>;
      expect(summaries).toHaveLength(1);
      expect(summaries[0]).toMatchObject({ id: 'transactions', version: '1.0.0', runCount: 0, outputs: [{ name: 'transactions', type: 'string' }] });
      expect(summaries[0]?.inputs.map((input) => input.name)).toEqual(expect.arrayContaining(['start_date', 'end_date']));
      const replay = await app.inject({ method: 'POST', url: '/api/workflows/transactions/runs', payload: { inputs: { member_id: '12345', start_date: '2026-09-01', end_date: '2026-09-11' } } });
      expect(replay.statusCode).toBe(201);
      expect(JSON.parse(replay.body)).toMatchObject({ llmCalls: 0, mode: 'replay' });
      expect(starts).toBe(1);
      const detail = JSON.parse((await app.inject('/api/workflows/transactions')).body) as { artifact: { capabilityId: string }; runs: Array<{ workflowId: string; mode: string }> };
      expect(detail.artifact.capabilityId).toBe('member.lookup-transaction-history');
      expect(detail.runs[0]).toMatchObject({ workflowId: 'transactions', mode: 'replay' });
      await app.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects unknown, missing, malformed, and archived invocations before replay', async () => {
    const root = await mkdtemp(join(tmpdir(), 'companion-workflow-validation-'));
    try {
      const artifact = observedArtifact(interpretGoal('Look up member 12345 and get a loan payoff quote for 2026-09-30.'));
      await mkdir(join(root, 'offline', 'artifacts'), { recursive: true });
      await writeFile(join(root, 'offline', 'artifacts', 'loan.json'), JSON.stringify(artifact));
      const surface = new ScriptedDemoSurfaceAdapter();
      const app = await createCompanion({ offline: true, runtimeDir: root, surface, discoveryModel: { decide: async () => { throw new Error('discovery model must not run'); } } });
      expect((await app.inject({ method: 'POST', url: '/api/workflows/missing/runs', payload: { inputs: {} } })).statusCode).toBe(404);
      expect((await app.inject({ method: 'POST', url: '/api/workflows/loan/runs', payload: { inputs: { member_id: '12345', as_of_date: '2026-02-30' } } })).statusCode).toBe(400);
      expect((await app.inject({ method: 'POST', url: '/api/workflows/loan/runs', payload: { inputs: { member_id: '12345', as_of_date: '2026-09-30', unexpected: 'x' } } })).statusCode).toBe(400);
      const patched = await app.inject({ method: 'PATCH', url: '/api/workflows/loan', payload: { title: 'Payoff quotes', description: 'Read-only quote', archived: true } });
      expect(patched.statusCode).toBe(200);
      expect((await app.inject({ method: 'POST', url: '/api/workflows/loan/runs', payload: { inputs: { member_id: '12345', as_of_date: '2026-09-30' } } })).statusCode).toBe(409);
      await app.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('honors an active saved workflow selection through conversational input completion', async () => {
    const root = await mkdtemp(join(tmpdir(), 'companion-selected-workflow-'));
    try {
      const artifact = observedArtifact(interpretGoal('Look up member 12345 and tell me their savings balance.'));
      await mkdir(join(root, 'offline', 'artifacts'), { recursive: true });
      await writeFile(join(root, 'offline', 'artifacts', 'balance.json'), JSON.stringify(artifact));
      const app = await createCompanion({ offline: true, runtimeDir: root, surface: new ScriptedDemoSurfaceAdapter(), discoveryModel: { decide: async () => { throw new Error('selected workflow must replay without discovery'); } } });

      const question = await app.inject({ method: 'POST', url: '/api/tasks', payload: { goal: "What's the balance?", context: { workflowId: 'balance', source: 'saved_automation' } } });
      expect(question.statusCode).toBe(200);
      const clarification = JSON.parse(question.body) as { status: string; conversationId: string };
      expect(clarification.status).toBe('needs_input');
      const replay = await app.inject({ method: 'POST', url: '/api/tasks', payload: { goal: 'member 12345', conversationId: clarification.conversationId } });
      expect(replay.statusCode).toBe(201);
      expect(JSON.parse(replay.body)).toMatchObject({ mode: 'replay', llmCalls: 0, intentModelCalls: 0 });
      await app.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects an archived saved workflow selection before discovery', async () => {
    const root = await mkdtemp(join(tmpdir(), 'companion-selected-archived-'));
    try {
      const artifact = observedArtifact(interpretGoal('Look up member 12345 and tell me their savings balance.'));
      await mkdir(join(root, 'offline', 'artifacts'), { recursive: true });
      await writeFile(join(root, 'offline', 'artifacts', 'balance.json'), JSON.stringify(artifact));
      await mkdir(join(root, 'offline', 'workflows'), { recursive: true });
      await writeFile(join(root, 'offline', 'workflows', 'balance.json'), JSON.stringify({ id: 'balance', title: 'Savings balance', archived: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }));
      const app = await createCompanion({ offline: true, runtimeDir: root, surface: new ScriptedDemoSurfaceAdapter(), discoveryModel: { decide: async () => { throw new Error('archived workflow must not discover'); } } });
      const response = await app.inject({ method: 'POST', url: '/api/tasks', payload: { goal: 'member 12345 balance', context: { workflowId: 'balance', source: 'saved_automation' } } });
      expect(response.statusCode).toBe(409);
      expect(JSON.parse(response.body)).toMatchObject({ error: 'workflow_archived' });
      await app.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('excludes archived workflows from ordinary matching so the request can be relearned', async () => {
    const root = await mkdtemp(join(tmpdir(), 'companion-relearn-archived-'));
    try {
      const artifact = observedArtifact(interpretGoal('Look up member 12345 and tell me their savings balance.'));
      await mkdir(join(root, 'offline', 'artifacts'), { recursive: true });
      await writeFile(join(root, 'offline', 'artifacts', 'balance.json'), JSON.stringify(artifact));
      await mkdir(join(root, 'offline', 'workflows'), { recursive: true });
      await writeFile(join(root, 'offline', 'workflows', 'balance.json'), JSON.stringify({ id: 'balance', title: 'Archived savings balance', archived: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }));
      const decisions = [
        { kind: 'fill', id: 'enter-member-id', target: { strategies: [{ label: 'Member ID' }] }, value: { fromInput: 'member_id' }, risk: 'READ_ONLY' },
        { kind: 'click', id: 'submit-member-search', target: { strategies: [{ role: 'button', name: 'Search' }] }, risk: 'READ_ONLY' },
        { kind: 'extract', id: 'extract-savings-balance', target: { strategies: [{ text: 'Current Balance' }] }, output: 'current_savings_balance', parseAs: 'money' },
        { kind: 'finish', id: 'finish-relearned', outputs: ['current_savings_balance'], checkpoint: 'Member Search' }
      ];
      let decisionIndex = 0;
      const app = await createCompanion({
        offline: true,
        runtimeDir: root,
        surface: new ScriptedDemoSurfaceAdapter(),
        discoveryModel: { decide: async () => decisions[decisionIndex++] }
      });
      const learned = await app.inject({ method: 'POST', url: '/api/tasks', payload: { goal: 'Look up member 12345 and tell me their savings balance.' } });
      expect(learned.statusCode).toBe(201);
      expect(JSON.parse(learned.body)).toMatchObject({ mode: 'discovery' });
      const workflows = JSON.parse((await app.inject('/api/workflows')).body) as Array<{ id: string; archived: boolean }>;
      expect(workflows).toHaveLength(2);
      expect(workflows.filter((workflow) => !workflow.archived)).toHaveLength(1);
      const selectedArchived = await app.inject({ method: 'POST', url: '/api/tasks', payload: { goal: 'Look up member 12345 and tell me their savings balance.', context: { workflowId: 'balance', source: 'saved_automation' } } });
      expect(selectedArchived.statusCode).toBe(409);
      expect(JSON.parse(selectedArchived.body)).toMatchObject({ error: 'workflow_archived' });
      await app.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
