import { describe, expect, it } from 'vitest';
import { createCompanion } from '../src/app/server.js';
import { ScriptedDiscoveryModel } from '../src/llm/client.js';
import { ScriptedDemoSurfaceAdapter } from '../src/surface/fake.js';

class CleanupSurface extends ScriptedDemoSurfaceAdapter {
  closed = 0;
  override async close(session: { id: string }): Promise<void> { this.closed += 1; await super.close(session); }
}

describe('same-session intervention API', () => {
  it('serves the screenshot and enforces claim, resume, and abort on one session', async () => {
    const app = await createCompanion({
      surface: new ScriptedDemoSurfaceAdapter(),
      discoveryModel: new ScriptedDiscoveryModel([{ kind: 'requestHuman', id: 'verify', reason: 'Supervisor verification required' }])
    });
    const created = await app.inject({ method: 'POST', url: '/api/tasks', payload: { goal: 'Look up member 12345 and tell me their savings balance.' } });
    const run = JSON.parse(created.body) as { runId: string };
    const state = JSON.parse((await app.inject(`/api/runs/${run.runId}`)).body) as { interventionId: string; status: string };
    expect(state.status).toBe('needs_human');
    expect(state.interventionId).toBeTruthy();
    const screenshot = await app.inject(`/api/interventions/${state.interventionId}/screenshot`);
    expect(screenshot.statusCode).toBe(200);
    const claim = await app.inject({ method: 'POST', url: `/api/interventions/${state.interventionId}/claim` });
    expect(JSON.parse(claim.body).status).toBe('claimed');
    const resume = await app.inject({ method: 'POST', url: `/api/interventions/${state.interventionId}/resume` });
    expect(JSON.parse(resume.body).sameSession).toBe(true);
    const abort = await app.inject({ method: 'POST', url: `/api/interventions/${state.interventionId}/abort` });
    expect(JSON.parse(abort.body).status).toBe('aborted');
    await app.close();
  });

  it('continues the paused discovery on resume and executes a post-resume action on the same session', async () => {
    const app = await createCompanion({
      surface: new ScriptedDemoSurfaceAdapter(),
      discoveryModel: new ScriptedDiscoveryModel([
        { kind: 'requestHuman', id: 'verify', reason: 'Supervisor verification required' },
        { kind: 'click', id: 'open-member-search', target: { strategies: [{ role: 'link', name: 'Member Search' }] }, risk: 'READ_ONLY' },
        { kind: 'finish', id: 'done', outputs: [], checkpoint: 'Member Search' }
      ])
    });
    const created = await app.inject({ method: 'POST', url: '/api/tasks', payload: { goal: 'Look up member 12345 and tell me their savings balance.' } });
    const run = JSON.parse(created.body) as { runId: string };
    const paused = JSON.parse((await app.inject(`/api/runs/${run.runId}`)).body) as { interventionId: string; status: string; sessionId: string };
    await app.inject({ method: 'POST', url: `/api/interventions/${paused.interventionId}/claim` });
    const resumed = await app.inject({ method: 'POST', url: `/api/interventions/${paused.interventionId}/resume` });
    expect(JSON.parse(resumed.body)).toMatchObject({ status: 'resumed', sameSession: true, sessionId: paused.sessionId });
    const completed = JSON.parse((await app.inject(`/api/runs/${run.runId}`)).body) as { status: string; sessionId: string; events: Array<{ stepId: string }> };
    expect(completed.status).toBe('succeeded');
    expect(completed.sessionId).toBe(paused.sessionId);
    expect(completed.events.some((event) => event.stepId === 'open-member-search')).toBe(true);
    await app.close();
  });

  it('closes a paused target session when Fastify shuts down', async () => {
    const surface = new CleanupSurface();
    const app = await createCompanion({
      surface,
      discoveryModel: new ScriptedDiscoveryModel([{ kind: 'requestHuman', id: 'verify', reason: 'Supervisor verification required' }])
    });
    await app.inject({ method: 'POST', url: '/api/tasks', payload: { goal: 'Look up member 12345 and tell me their savings balance.' } });
    await app.close();
    expect(surface.closed).toBe(1);
  });
});
