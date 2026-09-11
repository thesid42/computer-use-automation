import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PlaywrightSurfaceAdapter } from '../src/surface/playwright.js';
import type { SessionHandle } from '../src/surface/adapter.js';
import { DiscoveryRunner, type DiscoveryModel } from '../src/discovery/runner.js';
import { ReplayRunner } from '../src/replay/runner.js';
import { interpretGoal } from '../src/goal/interpret.js';
import { PolicyGate } from '../src/policy/gate.js';
import { ControlLease } from '../src/handoff/lease.js';
import type { RunEvent } from '../src/evidence/events.js';
import type { ProvisionalIntent } from '../src/goal/interpret.js';
import type { SurfaceSnapshot } from '../src/surface/adapter.js';

let legacy: ChildProcess | undefined;
let legacyUrl = 'http://127.0.0.1:3001';

async function availablePort(preferred: number): Promise<number> {
  for (const candidate of [preferred, 0]) {
    const server = createServer();
    try {
      const port = await new Promise<number>((resolve, reject) => {
        server.once('error', reject);
        server.listen({ host: '127.0.0.1', port: candidate }, () => resolve((server.address() as { port: number }).port));
      });
      await new Promise<void>((resolve) => server.close(() => resolve()));
      return port;
    } catch {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
  throw new Error('no legacy demo port available');
}

async function waitForLegacy(): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${legacyUrl}/`);
      if (response.ok) return;
    } catch { /* server is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('legacy demo did not start');
}

describe('Playwright surface iframe integration', () => {
  beforeAll(async () => {
    const port = await availablePort(3001);
    legacyUrl = `http://127.0.0.1:${port}`;
    legacy = spawn(process.execPath, ['--import', 'tsx/esm', 'src/server.ts'], {
      cwd: fileURLToPath(new URL('../../legacy-demo', import.meta.url)),
      env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
      stdio: ['ignore', 'ignore', 'pipe']
    });
    await waitForLegacy();
  });
  afterAll(async () => {
    if (!legacy || legacy.exitCode !== null) return;
    legacy.kill();
    await Promise.race([new Promise<void>((resolve) => legacy?.once('exit', () => resolve())), new Promise<void>((resolve) => setTimeout(resolve, 1000))]);
  });

  it('observes nested iframe controls with ephemeral frame refs and a real screenshot', async () => {
    const surface = new PlaywrightSurfaceAdapter();
    const session = await surface.start({ id: 'demo', applicationFamily: 'legacy-member-servicing', url: legacyUrl, headless: true });
    try {
      const snapshot = await surface.observe(session);
      const memberId = snapshot.controls.find((control) => control.label === 'Member ID');
      expect(memberId).toBeTruthy();
      expect(memberId?.framePath.length).toBeGreaterThan(0);
      expect(memberId?.ref).toMatch(/^control-/);
      expect(snapshot.screenshot).toMatch(/^data:image\/png;base64,/);
      expect(snapshot.visibleText).toContain('Member Search');

      const resolution = await surface.resolve(session, { strategies: [{ ref: memberId!.ref }] });
      expect(resolution.count).toBe(1);
      expect(resolution.resolvedControl?.label).toBe('Member ID');
      const result = await surface.act(session, { kind: 'fill', id: 'fill', target: { strategies: [{ ref: memberId!.ref }] }, value: '12345', risk: 'READ_ONLY' });
      expect(result.status).toBe('succeeded');
      const after = await surface.observe(session);
      expect(after.visibleText).toContain('Member Search');
    } finally {
      await surface.close(session);
    }
  });

  it('keeps each evidence capture immutable while exposing a latest screenshot', async () => {
    const surface = new PlaywrightSurfaceAdapter();
    const session = await surface.start({ id: 'demo', applicationFamily: 'legacy-member-servicing', url: legacyUrl, headless: true });
    try {
      const first = await surface.captureEvidence(session);
      const second = await surface.captureEvidence(session);
      expect(second.path).not.toBe(first.path);
      expect((await readFile(first.path)).length).toBeGreaterThan(0);
      expect((await readFile(second.path)).length).toBeGreaterThan(0);
    } finally {
      await surface.close(session);
    }
  });

  it('captures human page events with redacted input and frame navigation', async () => {
    const surface = new PlaywrightSurfaceAdapter();
    const session = await surface.start({ id: 'demo', applicationFamily: 'legacy-member-servicing', url: legacyUrl, headless: true });
    const events: Array<{ kind: string; details?: Record<string, unknown> }> = [];
    try {
      await surface.setHumanActionSink?.(session, (event) => { events.push(event); });
      const page = session.page as import('playwright').Page;
      const frame = page.frames().find((candidate) => candidate !== page.mainFrame());
      await frame?.getByLabel('Member ID').fill('12345');
      await frame?.getByRole('button', { name: 'Search' }).click();
      await page.waitForTimeout(100);
      expect(events.some((event) => event.kind === 'input' && event.details?.value === '[REDACTED]')).toBe(true);
      expect(events.some((event) => event.kind === 'click')).toBe(true);
      expect(events.some((event) => event.kind === 'navigation' && String(event.details?.url).includes('/servicing/member-search'))).toBe(true);
    } finally {
      await surface.close(session);
    }
  });

  it('discovers and replays the iframe workflow with real Playwright and no replay model calls', async () => {
    const surface = new PlaywrightSurfaceAdapter();
    const target = { id: 'demo', applicationFamily: 'legacy-member-servicing', url: legacyUrl, headless: true };
    const intent = interpretGoal('Look up member 12345 and tell me their savings balance.');
    const scripted: DiscoveryModel = { decide: async (snapshot: SurfaceSnapshot, _intent: ProvisionalIntent, events: RunEvent[]) => {
      const control = (predicate: (name: string, label?: string, text?: string) => boolean) => snapshot.controls.find((candidate) => predicate(candidate.name ?? '', candidate.label, candidate.text));
      const refAction = (kind: 'click' | 'fill', id: string, found: { ref: string }) => kind === 'click'
        ? { kind, id, target: { strategies: [{ ref: found.ref }] }, risk: 'READ_ONLY' as const }
        : { kind, id, target: { strategies: [{ ref: found.ref }] }, value: { fromInput: 'member_id' }, risk: 'READ_ONLY' as const };
      switch (events.length) {
        case 0: return refAction('fill', 'discover-member-id', control((_name, label) => label === 'Member ID')!);
        case 1: return refAction('click', 'discover-search', control((name) => name === 'Search')!);
        case 2: return refAction('click', 'discover-member-summary', control((name) => name === 'Member Summary')!);
        case 3: return refAction('click', 'discover-accounts', control((name) => name === 'Accounts')!);
        case 4: return refAction('click', 'discover-savings', control((name) => name === 'Savings Account')!);
        case 5: return refAction('click', 'discover-balance', control((name) => name === 'Balance Details')!);
        case 6: return { kind: 'extract', id: 'discover-balance-value', target: { strategies: [{ relativeText: 'Current Balance', framePath: ['title:Member Servicing Area'] }] }, output: 'current_savings_balance', parseAs: 'money' };
        default: return { kind: 'finish', id: 'discover-finish', outputs: ['current_savings_balance'], checkpoint: 'Current Balance visible' };
      }
    }};
    const policy = new PolicyGate({ allowedOrigins: [new URL(legacyUrl).origin], allowedRoutes: ['/', '/servicing*'], allowedActionKinds: ['click', 'fill', 'extract', 'finish'], maxRisk: 'READ_ONLY', controlOwner: 'automation' });
    const discovered = await new DiscoveryRunner(surface, scripted, policy, new ControlLease(), { maxActions: 10 }).run(intent, target);
    expect(discovered.runResult.status).toBe('succeeded');
    expect(discovered.artifact?.actions.map((action) => action.id)).toEqual([
      'discover-member-id', 'discover-search', 'discover-member-summary', 'discover-accounts', 'discover-savings', 'discover-balance', 'discover-balance-value', 'discover-finish'
    ]);
    expect(discovered.artifact?.actions.find((action) => action.id === 'discover-balance-value')).toMatchObject({ target: { strategies: [{ relativeText: 'Current Balance' }] } });
    expect(JSON.stringify(discovered.artifact)).not.toContain('control-');
    await surface.close(discovered.session);

    const replaySurface = new PlaywrightSurfaceAdapter();
    const replayRunner = new ReplayRunner(replaySurface, policy, new ControlLease());
    const replay = await replayRunner.run(discovered.artifact!, target, { member_id: '12345' });
    expect(replay).toMatchObject({ status: 'succeeded', checkpointVerified: true, outputs: { current_savings_balance: { amount: '1250.42', currency: 'USD' } } });
    await replaySurface.close(replayRunner.lastSession!);
  }, 15000);
});
