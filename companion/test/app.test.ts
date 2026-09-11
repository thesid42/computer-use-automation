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
});
