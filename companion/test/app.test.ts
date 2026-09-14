import { describe, expect, it } from 'vitest';
import { createCompanion } from '../src/app/server.js';
import { ScriptedDemoSurfaceAdapter } from '../src/surface/fake.js';
import type { DiscoveryModel } from '../src/discovery/runner.js';

class CountingSurface extends ScriptedDemoSurfaceAdapter {
  starts = 0;
  override async start(target: { id: string; applicationFamily: string; url: string; headless?: boolean }) { this.starts += 1; return super.start(target); }
}

describe('companion web API', () => {
  it('accepts one plain goal, presents result, then replays without LLM calls', async () => {
    const app = await createCompanion({ offline: true });
    const first = await app.inject({ method: 'POST', url: '/api/tasks', payload: { goal: 'Look up member 12345 and tell me their savings balance.' } });
    expect(first.statusCode).toBe(201);
    const firstRun = JSON.parse(first.body) as { runId: string; llmCalls: number };
    expect(firstRun.llmCalls).toBeGreaterThan(0);
    const firstStatus = await app.inject(`/api/runs/${firstRun.runId}`);
    expect(JSON.parse(firstStatus.body).result).toMatchObject({ status: 'succeeded', outputs: { current_savings_balance: { amount: '1250.42', currency: 'USD' } } });

    const second = await app.inject({ method: 'POST', url: '/api/tasks', payload: { goal: 'Savings balance for member 12345' } });
    const secondRun = JSON.parse(second.body) as { runId: string; llmCalls: number };
    expect(secondRun.llmCalls).toBe(0);
    expect((await app.inject(`/api/runs/${secondRun.runId}`)).body).toContain('succeeded');
    await app.close();
  });

  it('clarifies unsupported write-like goals before starting a browser or discovery model', async () => {
    const surface = new CountingSurface();
    let modelCalls = 0;
    const model: DiscoveryModel = { decide: async () => { modelCalls += 1; return { kind: 'finish', id: 'done', outputs: [], checkpoint: 'ready' }; } };
    const app = await createCompanion({ surface, discoveryModel: model });
    const response = await app.inject({ method: 'POST', url: '/api/tasks', payload: { goal: 'Post a fee for member 12345' } });
    expect(response.statusCode).toBe(201);
    const created = JSON.parse(response.body) as { runId: string; llmCalls: number; mode: string };
    expect(created).toMatchObject({ llmCalls: 0, mode: 'clarification' });
    expect((await app.inject(`/api/runs/${created.runId}`)).body).toMatch(/read-only requests/);
    expect(surface.starts).toBe(0);
    expect(modelCalls).toBe(0);
    await app.close();
  });

  it('keeps missing values in a conversation and resumes the original request', async () => {
    const app = await createCompanion({ offline: true });
    const question = await app.inject({ method: 'POST', url: '/api/tasks', payload: { goal: "What's the balance?" } });
    expect(question.statusCode).toBe(200);
    const clarification = JSON.parse(question.body) as { status: string; message: string; conversationId: string };
    expect(clarification).toMatchObject({ status: 'needs_input' });
    expect(clarification.message).toMatch(/member|customer/i);
    expect(clarification.conversationId).toMatch(/^conversation-/);

    const completed = await app.inject({ method: 'POST', url: '/api/tasks', payload: { goal: 'member 12345', conversationId: clarification.conversationId } });
    expect(completed.statusCode).toBe(201);
    const run = JSON.parse(completed.body) as { runId: string; llmCalls: number };
    expect(run.llmCalls).toBeGreaterThan(0);
    expect((await app.inject(`/api/runs/${run.runId}`)).body).toContain('succeeded');
    await app.close();
  });

  it('uses a grounded provider intent to learn an unlisted read-only workflow', async () => {
    let intentCalls = 0;
    let actionCalls = 0;
    const model: DiscoveryModel & { interpretGoal: (goal: string, context?: unknown) => Promise<unknown> } = {
      interpretGoal: async (goal) => {
        intentCalls += 1;
        return {
          objective: 'lookup_branch_directory',
          entities: [{ proposedName: 'branch_name', value: 'New York', sourceSpan: 'New York', type: 'string', sensitivity: 'plain' }],
          requestedOutputs: [{ proposedName: 'branch_directory', type: 'string' }],
          risk: 'read_only', userGoal: goal,
          requiredConcepts: ['branch', 'directory'], phrases: ['show branch directory in {branch_name}']
        };
      },
      decide: async (_snapshot, _intent, events) => {
        actionCalls += 1;
        if (events.length === 0) return { kind: 'fill', id: 'fill-branch', target: { strategies: [{ label: 'Branch' }] }, value: { fromInput: 'branch_name' }, risk: 'READ_ONLY' };
        if (!events.some((event) => event.kind === 'action' && typeof event.action === 'object' && (event.action as { kind?: string }).kind === 'extract')) return { kind: 'extract', id: 'extract-directory', target: { strategies: [{ text: 'Member Search' }] }, output: 'branch_directory', parseAs: 'string' };
        return { kind: 'finish', id: 'finish-directory', outputs: ['branch_directory'], checkpoint: 'Member Search' };
      }
    };
    const app = await createCompanion({ offline: true, surface: new ScriptedDemoSurfaceAdapter(), discoveryModel: model });
    const response = await app.inject({ method: 'POST', url: '/api/tasks', payload: { goal: 'Show branch directory in New York.' } });
    expect(response.statusCode).toBe(201);
    const handle = JSON.parse(response.body) as { runId: string; llmCalls: number; intentModelCalls: number };
    expect(handle).toMatchObject({ llmCalls: actionCalls, intentModelCalls: 1 });
    expect(intentCalls).toBe(1);
    const run = JSON.parse((await app.inject(`/api/runs/${handle.runId}`)).body) as { status: string; result: { status: string } };
    expect(run).toMatchObject({ status: 'succeeded', result: { status: 'succeeded' } });
    const summaries = JSON.parse((await app.inject('/api/workflows')).body) as Array<{ intentModelCalls?: number; inputs: Array<{ name: string }>; outputs: Array<{ name: string }> }>;
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({ inputs: [{ name: 'branch_name' }], outputs: [{ name: 'branch_directory', type: 'string' }] });
    await app.close();
  });

  it('rejects provider entities whose normalized value is absent from its source span', async () => {
    let actionCalls = 0;
    const model: DiscoveryModel & { interpretGoal: (goal: string, context?: unknown) => Promise<unknown> } = {
      interpretGoal: async (goal) => ({
        objective: 'lookup_branch_directory',
        entities: [{ proposedName: 'branch_name', value: 'Southside', sourceSpan: 'Northside', type: 'string', sensitivity: 'plain' }],
        requestedOutputs: [{ proposedName: 'branch_directory', type: 'string' }],
        risk: 'read_only', userGoal: goal, requiredConcepts: ['branch', 'directory']
      }),
      decide: async () => { actionCalls += 1; return { kind: 'finish', id: 'finish', outputs: [], checkpoint: 'Member Search' }; }
    };
    const app = await createCompanion({ offline: true, discoveryModel: model });
    const response = await app.inject({ method: 'POST', url: '/api/tasks', payload: { goal: 'Show branch directory in Northside.' } });
    expect(response.statusCode).toBe(502);
    expect(JSON.parse(response.body)).toMatchObject({ error: 'intent_interpretation_failed', category: 'intent_protocol', intentModelCalls: 1 });
    expect(actionCalls).toBe(0);
    await app.close();
  });
});
