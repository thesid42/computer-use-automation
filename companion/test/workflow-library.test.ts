import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCompanion } from '../src/app/server.js';
import { compileCapability } from '../src/artifact/compiler.js';
import { interpretGoal } from '../src/goal/interpret.js';
import { ScriptedDemoSurfaceAdapter } from '../src/surface/fake.js';

describe('durable workflow library', () => {
  it('replays a stored family artifact directly without invoking the discovery model', async () => {
    const root = await mkdtemp(join(tmpdir(), 'companion-workflows-'));
    try {
      const artifact = compileCapability(interpretGoal('Look up member 12345 and list transactions from 2026-09-01 to 2026-09-11.'), []);
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
      const artifact = compileCapability(interpretGoal('Look up member 12345 and get a loan payoff quote for 2026-09-30.'), []);
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
});
