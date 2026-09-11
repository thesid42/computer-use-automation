import { describe, expect, it } from 'vitest';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCompanion } from '../src/app/server.js';
import { ScriptedDemoSurfaceAdapter } from '../src/surface/fake.js';

const goal = 'Look up member 12345 and tell me their savings balance.';

describe('companion backend reliability', () => {
  it('loads a validated compatible workflow and terminal history after restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'companion-restart-'));
    try {
      const first = await createCompanion({ offline: true, runtimeDir: root });
      const created = JSON.parse((await first.inject({ method: 'POST', url: '/api/tasks', payload: { goal } })).body) as { runId: string; llmCalls: number };
      expect(created.llmCalls).toBeGreaterThan(0);
      await first.close();

      const restarted = await createCompanion({ offline: true, runtimeDir: root });
      const context = JSON.parse((await restarted.inject('/api/context')).body) as { learnedWorkflow: unknown; executionMode: string; discoveryConfigured: boolean; targetUrl: string };
      expect(context).toMatchObject({ executionMode: 'offline', discoveryConfigured: false, targetUrl: 'http://localhost:3001' });
      expect(context.learnedWorkflow).toBeTruthy();
      const history = JSON.parse((await restarted.inject('/api/runs')).body) as Array<{ id: string; status: string }>;
      expect(history.some((run) => run.id === created.runId && run.status === 'succeeded')).toBe(true);
      const replay = JSON.parse((await restarted.inject({ method: 'POST', url: '/api/tasks', payload: { goal: 'Savings balance for member 12345' } })).body) as { llmCalls: number };
      expect(replay.llmCalls).toBe(0);
      await restarted.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not expose an offline artifact through the live runtime namespace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'companion-isolation-'));
    try {
      const offline = await createCompanion({ offline: true, runtimeDir: root });
      await offline.inject({ method: 'POST', url: '/api/tasks', payload: { goal } });
      await offline.close();
      const live = await createCompanion({ offline: false, runtimeDir: root });
      const context = JSON.parse((await live.inject('/api/context')).body) as { executionMode: string; learnedWorkflow: unknown };
      expect(context).toEqual(expect.objectContaining({ executionMode: 'live', learnedWorkflow: null }));
      await live.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('returns an async run handle and exposes replay events through polling', async () => {
    const root = await mkdtemp(join(tmpdir(), 'companion-async-'));
    try {
      const app = await createCompanion({ offline: true, runtimeDir: root });
      const accepted = await app.inject({ method: 'POST', url: '/api/tasks', headers: { prefer: 'respond-async' }, payload: { goal } });
      expect(accepted.statusCode).toBe(202);
      const handle = JSON.parse(accepted.body) as { runId: string; status: string };
      expect(handle.status).toBe('pending');
      let state: { status: string } | undefined;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        state = JSON.parse((await app.inject(`/api/runs/${handle.runId}`)).body) as { status: string };
        if (state?.status !== 'pending' && state?.status !== 'running') break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(state?.status).toBe('succeeded');
      const firstEvents = JSON.parse((await app.inject(`/api/runs/${handle.runId}/events`)).body) as Array<{ kind: string }>;
      expect(firstEvents.some((event) => event.kind === 'action')).toBe(true);
      const replay = JSON.parse((await app.inject({ method: 'POST', url: '/api/tasks', payload: { goal: 'Savings balance for member 12345' } })).body) as { runId: string; llmCalls: number };
      expect(replay.llmCalls).toBe(0);
      const replayEvents = JSON.parse((await app.inject(`/api/runs/${replay.runId}/events`)).body) as Array<{ kind: string }>;
      expect(replayEvents.some((event) => event.kind === 'action')).toBe(true);
      await app.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps the original terminal failure and one result event when async persistence races', async () => {
    const root = await mkdtemp(join(tmpdir(), 'companion-persist-race-'));
    try {
      const app = await createCompanion({
        runtimeDir: root,
        surface: new ScriptedDemoSurfaceAdapter({ evidenceRoot: join(root, 'offline', 'evidence') }),
        discoveryModel: { decide: async () => ({ kind: 'fill', id: 'fill-missing-value', target: { strategies: [{ ref: 'control-1-1' }] } }) }
      });
      const accepted = await app.inject({ method: 'POST', url: '/api/tasks', headers: { prefer: 'respond-async' }, payload: { goal } });
      const handle = JSON.parse(accepted.body) as { runId: string };
      let state: { status: string; result?: { status: string; error?: { code: string } } } | undefined;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        state = JSON.parse((await app.inject(`/api/runs/${handle.runId}`)).body) as typeof state;
        if (state?.status !== 'pending' && state?.status !== 'running') break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(state).toBeDefined();
      expect(state!).toMatchObject({ status: 'failed', result: { status: 'failed', error: { code: 'MODEL_ACTION_INVALID' } } });
      const events = JSON.parse((await app.inject(`/api/runs/${handle.runId}/events`)).body) as Array<{ kind: string; stepId: string }>;
      expect(events.filter((event) => event.kind === 'result' && event.stepId === 'result')).toHaveLength(1);
      for (let attempt = 0; attempt < 40; attempt += 1) {
        try { await access(join(root, 'evidence', handle.runId, 'summary.json')); break; }
        catch { await new Promise((resolve) => setTimeout(resolve, 5)); }
      }
      await app.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('counts both bounded model repair calls in the async run handle', async () => {
    const root = await mkdtemp(join(tmpdir(), 'companion-model-repair-'));
    try {
      let repairs = 0;
      const app = await createCompanion({
        runtimeDir: root,
        surface: new ScriptedDemoSurfaceAdapter({ evidenceRoot: join(root, 'evidence') }),
        discoveryModel: {
          decide: async () => ({ kind: 'click', id: 'missing-target' }),
          repair: async () => {
            repairs += 1;
            return repairs === 1
              ? { kind: 'click', id: 'still-invalid', target: {} }
              : { kind: 'requestHuman', id: 'verification', reason: 'Repair test' };
          }
        }
      });
      const accepted = await app.inject({ method: 'POST', url: '/api/tasks', headers: { prefer: 'respond-async' }, payload: { goal } });
      const handle = JSON.parse(accepted.body) as { runId: string; llmCalls?: number };
      let state: { status: string; llmCalls?: number } | undefined;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        state = JSON.parse((await app.inject(`/api/runs/${handle.runId}`)).body) as typeof state;
        if (state?.status !== 'pending' && state?.status !== 'running') break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(state).toMatchObject({ status: 'needs_human', llmCalls: 3 });
      expect(repairs).toBe(2);
      await app.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('turns an unexpected surface startup exception into a failed run and closes cleanly', async () => {
    class FailingSurface extends ScriptedDemoSurfaceAdapter {
      override async start(): Promise<never> { throw new Error('surface_start_boom'); }
    }
    const root = await mkdtemp(join(tmpdir(), 'companion-failure-'));
    try {
      const app = await createCompanion({ offline: true, runtimeDir: root, surface: new FailingSurface() });
      const response = await app.inject({ method: 'POST', url: '/api/tasks', payload: { goal } });
      expect(response.statusCode).toBe(201);
      const handle = JSON.parse(response.body) as { runId: string };
      const run = JSON.parse((await app.inject(`/api/runs/${handle.runId}`)).body) as { status: string; result: { status: string; error: { code: string; message: string } } };
      expect(run).toMatchObject({ status: 'failed', result: { status: 'failed', error: { code: 'UNEXPECTED_FAILURE', message: 'surface_start_boom' } } });
      await app.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
