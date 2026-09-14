import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DiscoveryRunner, type DiscoveryModel } from '../src/discovery/runner.js';
import { ReplayRunner } from '../src/replay/runner.js';
import { ControlLease } from '../src/handoff/lease.js';
import { PolicyGate } from '../src/policy/gate.js';
import { interpretGoal, type ProvisionalIntent } from '../src/goal/interpret.js';
import { PlaywrightSurfaceAdapter } from '../src/surface/playwright.js';
import type { RunEvent } from '../src/evidence/events.js';
import type { SurfaceSnapshot, TargetProfile } from '../src/surface/adapter.js';

// This is bounded browser integration coverage with an explicit scripted
// discovery model. It verifies the UI and compiled/replayed artifact contract
// without using a provider or treating this run as live-model evidence.
const companionDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const legacyDir = resolve(companionDir, '..', 'legacy-demo');
const tsxCli = resolve(companionDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');

async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolvePromise());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : undefined;
  await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
  if (!port) throw new Error('unable_to_allocate_test_port');
  return port;
}

async function startLegacyServer(): Promise<{ process: ChildProcess; target: TargetProfile }> {
  const port = await unusedPort();
  const child = spawn(process.execPath, [tsxCli, 'src/server.ts'], {
    cwd: legacyDir,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
    stdio: 'ignore'
  });
  const url = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${url}/servicing`);
      if (response.ok) return {
        process: child,
        target: { id: 'legacy-demo-playwright', applicationFamily: 'legacy-member-servicing', url: `${url}/`, headless: true }
      };
    } catch {
      // The independently started TypeScript server may need a few turns to boot.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  child.kill();
  throw new Error(`legacy_server_did_not_start:${url}`);
}

function policyFor(target: TargetProfile): PolicyGate {
  return new PolicyGate({
    allowedOrigins: [new URL(target.url).origin],
    allowedRoutes: ['/', '/servicing*'],
    allowedActionKinds: ['click', 'fill', 'selectOption', 'wait', 'extract', 'finish', 'requestHuman'],
    maxRisk: 'READ_ONLY',
    controlOwner: 'automation',
    blockedTargetNamePatterns: ['Post Fee']
  });
}

function action(kind: string, id: string, target?: Record<string, unknown>, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { kind, id, ...(target ? { target: { strategies: [target] } } : {}), ...extra };
}

class ScriptedWorkflowModel implements DiscoveryModel {
  calls = 0;
  readonly decisions: string[] = [];
  lastVisibleText = '';

  constructor(private readonly steps: Array<Record<string, unknown>>) {}

  async decide(snapshot: SurfaceSnapshot, _intent: ProvisionalIntent, priorEvents: RunEvent[]): Promise<unknown> {
    const index = priorEvents.filter((event) => event.kind === 'action').length;
    const next = this.steps[index];
    this.calls += 1;
    this.lastVisibleText = snapshot.visibleText.replace(/\d{4,}/g, '[REDACTED]').slice(-240);
    if (!next) throw new Error(`scripted_model_exhausted:${index}`);
    this.decisions.push(String(next.id ?? `step-${index}`));
    return next;
  }
}

function diagnostic(model: ScriptedWorkflowModel, trace: string[], result: unknown): string {
  return JSON.stringify({ result, modelCalls: model.calls, decisions: model.decisions, lastVisibleText: model.lastVisibleText, trace });
}

function transactionModel(): ScriptedWorkflowModel {
  return new ScriptedWorkflowModel([
    action('fill', 'enter-member-id', { label: 'Member ID' }, { value: { fromInput: 'member_id' }, risk: 'READ_ONLY' }),
    action('click', 'submit-member-search', { role: 'button', name: 'Search' }, { risk: 'READ_ONLY' }),
    action('wait', 'wait-search-results', undefined, { condition: 'text:Search Results', timeoutMs: 10000 }),
    action('click', 'open-member-result', { text: 'Member Summary' }, { risk: 'READ_ONLY' }),
    action('wait', 'wait-member-summary', undefined, { condition: 'text:Member Summary', timeoutMs: 10000 }),
    action('click', 'open-accounts', { role: 'link', name: 'Accounts' }, { risk: 'READ_ONLY' }),
    action('wait', 'wait-accounts', undefined, { condition: 'text:Accounts', timeoutMs: 10000 }),
    action('click', 'open-savings-account', { text: 'Savings Account' }, { risk: 'READ_ONLY' }),
    action('wait', 'wait-savings-account', undefined, { condition: 'text:Savings Account', timeoutMs: 10000 }),
    action('click', 'open-transaction-history', { text: 'Transaction History' }, { risk: 'READ_ONLY' }),
    action('wait', 'wait-transaction-history', undefined, { condition: 'text:Transaction History', timeoutMs: 10000 }),
    action('fill', 'enter-start-date', { label: 'Start Date' }, { value: { fromInput: 'start_date' }, risk: 'READ_ONLY' }),
    action('fill', 'enter-end-date', { label: 'End Date' }, { value: { fromInput: 'end_date' }, risk: 'READ_ONLY' }),
    action('click', 'search-transactions', { role: 'button', name: 'Search Transactions' }, { risk: 'READ_ONLY' }),
    action('wait', 'wait-transaction-results', undefined, { condition: 'text:Transaction results', timeoutMs: 10000 }),
    action('extract', 'extract-transactions', { text: 'Transaction results' }, { output: 'transactions', parseAs: 'string' }),
    action('finish', 'finish-transactions', undefined, { outputs: ['transactions'], checkpoint: 'Transaction History' })
  ]);
}

function savingsModel(): ScriptedWorkflowModel {
  return new ScriptedWorkflowModel([
    action('fill', 'enter-member-id', { label: 'Member ID' }, { value: { fromInput: 'member_id' }, risk: 'READ_ONLY' }),
    action('click', 'submit-member-search', { role: 'button', name: 'Search' }, { risk: 'READ_ONLY' }),
    action('wait', 'wait-search-results', undefined, { condition: 'text:Search Results', timeoutMs: 10000 }),
    action('click', 'open-member-result', { text: 'Member Summary' }, { risk: 'READ_ONLY' }),
    action('wait', 'wait-member-summary', undefined, { condition: 'text:Member Summary', timeoutMs: 10000 }),
    action('click', 'open-accounts', { role: 'link', name: 'Accounts' }, { risk: 'READ_ONLY' }),
    action('wait', 'wait-accounts', undefined, { condition: 'text:Accounts', timeoutMs: 10000 }),
    action('click', 'open-savings-account', { text: 'Savings Account' }, { risk: 'READ_ONLY' }),
    action('wait', 'wait-savings-account', undefined, { condition: 'text:Savings Account', timeoutMs: 10000 }),
    action('click', 'open-balance-details', { role: 'link', name: 'Balance Details' }, { risk: 'READ_ONLY' }),
    action('wait', 'wait-balance-details', undefined, { condition: 'text:Balance Details', timeoutMs: 10000 }),
    action('extract', 'extract-savings-balance', { text: 'Current Balance' }, { output: 'current_savings_balance', parseAs: 'money' }),
    action('finish', 'finish-savings-balance', undefined, { outputs: ['current_savings_balance'], checkpoint: 'Balance Details' })
  ]);
}

function loanModel(): ScriptedWorkflowModel {
  return new ScriptedWorkflowModel([
    action('fill', 'enter-member-id', { label: 'Member ID' }, { value: { fromInput: 'member_id' }, risk: 'READ_ONLY' }),
    action('click', 'submit-member-search', { role: 'button', name: 'Search' }, { risk: 'READ_ONLY' }),
    action('wait', 'wait-search-results', undefined, { condition: 'text:Search Results', timeoutMs: 10000 }),
    action('click', 'open-member-result', { text: 'Member Summary' }, { risk: 'READ_ONLY' }),
    action('wait', 'wait-member-summary', undefined, { condition: 'text:Member Summary', timeoutMs: 10000 }),
    action('click', 'open-accounts', { role: 'link', name: 'Accounts' }, { risk: 'READ_ONLY' }),
    action('wait', 'wait-accounts', undefined, { condition: 'text:Accounts', timeoutMs: 10000 }),
    action('click', 'open-loan-accounts', { text: 'Loan Accounts' }, { risk: 'READ_ONLY' }),
    action('wait', 'wait-loan-accounts', undefined, { condition: 'text:Loan Accounts', timeoutMs: 10000 }),
    action('click', 'open-auto-loan', { text: 'Auto Loan' }, { risk: 'READ_ONLY' }),
    action('wait', 'wait-auto-loan', undefined, { condition: 'text:Auto Loan', timeoutMs: 10000 }),
    action('click', 'request-payoff-quote', { role: 'link', name: 'Request Payoff Quote' }, { risk: 'READ_ONLY' }),
    action('wait', 'wait-payoff-form', undefined, { condition: 'text:Request Payoff Quote', timeoutMs: 10000 }),
    action('fill', 'enter-as-of-date', { label: 'As-of Date' }, { value: { fromInput: 'as_of_date' }, risk: 'READ_ONLY' }),
    action('click', 'submit-payoff-quote', { role: 'button', name: 'Request Payoff Quote' }, { risk: 'READ_ONLY' }),
    action('wait', 'wait-payoff-review', undefined, { condition: 'text:Payoff quote review', timeoutMs: 10000 }),
    action('extract', 'extract-payoff-quote', { text: 'Payoff Amount' }, { output: 'payoff_quote', parseAs: 'money' }),
    action('finish', 'finish-payoff-quote', undefined, { outputs: ['payoff_quote'], checkpoint: 'Payoff quote review' })
  ]);
}

async function closeProcess(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.killed || child.exitCode !== null) return;
  child.kill();
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
}

describe('legacy target workflows through a real browser', () => {
  let legacy: { process: ChildProcess; target: TargetProfile };
  let evidenceRoot: string;

  beforeAll(async () => {
    legacy = await startLegacyServer();
    evidenceRoot = await mkdtemp(resolve(tmpdir(), 'companion-playwright-workflows-'));
  }, 30000);

  afterAll(async () => {
    await rm(evidenceRoot, { recursive: true, force: true });
    await closeProcess(legacy?.process);
  });

  it('discovers, compiles, and replays transaction history with changed dates and a no-results outcome', async () => {
    const surface = new PlaywrightSurfaceAdapter({ evidenceRoot });
    const policy = policyFor(legacy.target);
    const lease = new ControlLease();
    const model = transactionModel();
    const intent = interpretGoal('Find member 12345 transactions from 2026-09-01 to 2026-09-11.');
    const trace: string[] = [];
    const discovery = new DiscoveryRunner(surface, model, policy, lease, { maxActions: 24, retries: 1, maxElapsedMs: 60000, onEvent: (event) => { trace.push(`${event.kind}:${event.stepId}:${event.outcome}`); } });
    const replay = new ReplayRunner(surface, policy, lease);
    let discoverySession: import('../src/surface/adapter.js').SessionHandle | undefined;
    try {
      const learned = await discovery.run(intent, legacy.target);
      discoverySession = learned.session;
      expect(learned.runResult.status, diagnostic(model, trace, learned.runResult)).toBe('succeeded');
      if (learned.runResult.status !== 'succeeded' || !learned.artifact) throw new Error('transaction_discovery_did_not_compile');
      expect(learned.runResult.checkpointVerified).toBe(true);
      const transactionActions = JSON.stringify(learned.artifact.actions);
      expect(transactionActions).toContain('Start Date');
      expect(transactionActions).toContain('End Date');
      expect(transactionActions).toContain('Search Transactions');
      expect(transactionActions).toContain('Transaction results');
      expect(learned.runResult.outputs.transactions).toContain('2026-09-10');
      expect(learned.runResult.outputs.transactions).toContain('2026-09-07');
      expect(learned.runResult.outputs.transactions).toContain('2026-09-03');
      expect(learned.runResult.outputs.transactions).not.toContain('2026-08-28');
      expect(learned.artifact.finalCheckpoint).toBe('Transaction History');
      expect(model.calls).toBeGreaterThan(0);

      const callsBeforeReplay = model.calls;
      const august = await replay.run(learned.artifact, legacy.target, { member_id: '12345', start_date: '2026-08-01', end_date: '2026-08-31' });
      expect(model.calls).toBe(callsBeforeReplay);
      expect(august.status, diagnostic(model, trace, august)).toBe('succeeded');
      if (august.status !== 'succeeded') throw new Error('august_transaction_replay_failed');
      expect(august.checkpointVerified).toBe(true);
      expect(String(august.outputs.transactions)).toContain('2026-08-28');
      expect(String(august.outputs.transactions)).toContain('2026-08-15');
      expect(String(august.outputs.transactions)).not.toContain('2026-09-10');

      const empty = await replay.run(learned.artifact, legacy.target, { member_id: '12345', start_date: '2026-10-01', end_date: '2026-10-31' });
      expect(empty).toMatchObject({ status: 'business_outcome', code: 'NO_TRANSACTIONS' });
    } finally {
      if (discoverySession) await surface.close(discoverySession);
      if (replay.lastSession && replay.lastSession.id !== discoverySession?.id) await surface.close(replay.lastSession);
    }
  }, 120000);

  it('replays savings after a visible Retry Search recovery for member 77777', async () => {
    const surface = new PlaywrightSurfaceAdapter({ evidenceRoot });
    const policy = policyFor(legacy.target);
    const lease = new ControlLease();
    const model = savingsModel();
    const intent = interpretGoal('Find member 12345 savings balance.');
    const discovery = new DiscoveryRunner(surface, model, policy, lease, { maxActions: 20, retries: 1, maxElapsedMs: 60000 });
    const recoveryEvents: RunEvent[] = [];
    const replay = new ReplayRunner(surface, policy, lease, undefined, (event) => { recoveryEvents.push(event); });
    let discoverySession: import('../src/surface/adapter.js').SessionHandle | undefined;
    try {
      const learned = await discovery.run(intent, legacy.target);
      discoverySession = learned.session;
      expect(learned.runResult.status).toBe('succeeded');
      if (learned.runResult.status !== 'succeeded' || !learned.artifact) throw new Error('savings_discovery_did_not_compile');
      const callsBeforeReplay = model.calls;
      const result = await replay.run(learned.artifact, legacy.target, { member_id: '77777' });
      expect(model.calls).toBe(callsBeforeReplay);
      expect(result, JSON.stringify({ result, recoveryEvents })).toMatchObject({ status: 'succeeded', outputs: { current_savings_balance: { amount: '843.17', currency: 'USD' } } });
      expect(recoveryEvents.some((event) => event.stepId.startsWith('recover-') && event.kind === 'action' && (event.action as { kind?: string } | undefined)?.kind === 'click')).toBe(true);
    } finally {
      if (discoverySession) await surface.close(discoverySession);
      if (replay.lastSession && replay.lastSession.id !== discoverySession?.id) await surface.close(replay.lastSession);
    }
  }, 120000);

  it('discovers, compiles, and replays a loan payoff quote with changed as-of dates and unsupported-date outcome', async () => {
    const surface = new PlaywrightSurfaceAdapter({ evidenceRoot });
    const policy = policyFor(legacy.target);
    const lease = new ControlLease();
    const model = loanModel();
    const intent = interpretGoal('Get member 12345 loan payoff quote for 2026-09-30.');
    const trace: string[] = [];
    const discovery = new DiscoveryRunner(surface, model, policy, lease, { maxActions: 26, retries: 1, maxElapsedMs: 60000, onEvent: (event) => { trace.push(`${event.kind}:${event.stepId}:${event.outcome}`); } });
    const replay = new ReplayRunner(surface, policy, lease);
    let discoverySession: import('../src/surface/adapter.js').SessionHandle | undefined;
    try {
      const learned = await discovery.run(intent, legacy.target);
      discoverySession = learned.session;
      expect(learned.runResult.status, diagnostic(model, trace, learned.runResult)).toBe('succeeded');
      if (learned.runResult.status !== 'succeeded' || !learned.artifact) throw new Error('loan_discovery_did_not_compile');
      expect(learned.runResult.checkpointVerified).toBe(true);
      const loanActions = JSON.stringify(learned.artifact.actions);
      expect(loanActions).toContain('Loan Accounts');
      expect(loanActions).toContain('Auto Loan');
      expect(loanActions).toContain('As-of Date');
      expect(loanActions).toContain('Payoff Amount');
      expect(learned.runResult.outputs.payoff_quote).toEqual({ amount: '18968.53', currency: 'USD' });
      expect(learned.artifact.finalCheckpoint).toBe('Payoff quote review');
      expect(learned.artifact.actions.find((action) => action.kind === 'extract')).toMatchObject({ target: { strategies: [{ relativeText: 'Payoff Amount' }] } });
      expect(model.calls).toBeGreaterThan(0);

      const callsBeforeReplay = model.calls;
      const later = await replay.run(learned.artifact, legacy.target, { member_id: '12345', as_of_date: '2026-10-15' });
      expect(model.calls).toBe(callsBeforeReplay);
      expect(later.status).toBe('succeeded');
      if (later.status !== 'succeeded') throw new Error('later_payoff_replay_failed');
      expect(later.checkpointVerified).toBe(true);
      expect(later.outputs.payoff_quote).toEqual({ amount: '18974.68', currency: 'USD' });
      expect(later.outputs.payoff_quote).not.toEqual({ amount: '18968.53', currency: 'USD' });

      const unsupported = await replay.run(learned.artifact, legacy.target, { member_id: '12345', as_of_date: '2027-01-01' });
      expect(unsupported).toMatchObject({ status: 'business_outcome', code: 'UNSUPPORTED_AS_OF_DATE' });
    } finally {
      if (discoverySession) await surface.close(discoverySession);
      if (replay.lastSession && replay.lastSession.id !== discoverySession?.id) await surface.close(replay.lastSession);
    }
  }, 120000);
});
