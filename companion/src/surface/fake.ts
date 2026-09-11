import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ArtifactAction, TargetSpec } from '../artifact/schema.js';
import type { ActionResult, SessionHandle, SurfaceAdapter, SurfaceSnapshot, TargetProfile } from './adapter.js';

type DemoFamily = 'savings' | 'transactions' | 'loan';
type State = { target: TargetProfile; memberId: string; path: string; aborted: boolean; family: DemoFamily; startDate: string; endDate: string; asOfDate: string; transientSeen: boolean };

export class ScriptedDemoSurfaceAdapter implements SurfaceAdapter {
  private readonly states = new Map<string, State>();

  constructor(private readonly options: { evidenceRoot?: string } = {}) {}

  async start(target: TargetProfile): Promise<SessionHandle> {
    const id = `offline-${crypto.randomUUID()}`;
    this.states.set(id, { target, memberId: '', path: '/', aborted: false, family: 'savings', startDate: '', endDate: '', asOfDate: '', transientSeen: false });
    return { id };
  }

  private state(session: SessionHandle): State {
    const state = this.states.get(session.id);
    if (!state) throw new Error('session_not_found');
    return state;
  }

  async observe(session: SessionHandle): Promise<SurfaceSnapshot> {
    const state = this.state(session);
    const dateControls = state.family === 'transactions'
      ? [{ ref: 'start-date', role: 'textbox', name: 'Start Date', label: 'Start Date', framePath: [] }, { ref: 'end-date', role: 'textbox', name: 'End Date', label: 'End Date', framePath: [] }]
      : state.family === 'loan' ? [{ ref: 'as-of-date', role: 'textbox', name: 'As of Date', label: 'As of Date', framePath: [] }] : [];
    const visible = state.path.endsWith('/balance-details') ? 'Balance Details Current Balance $1,250.42'
      : state.path.endsWith('/temporary') ? 'TEMPORARY_LOAD_FAILURE Retry Search'
      : state.path.endsWith('/transaction-history') ? 'Transaction History Transactions 2026-09-01 2026-09-11'
        : state.path.endsWith('/loan-payoff') ? 'Loan Payoff Quote Payoff Quote $9876.54'
          : 'Member Search Accounts';
    return {
      url: new URL(state.path, state.target.url).toString(), title: 'Demo Credit Union · Member Servicing', framePath: [],
      controls: [
        { ref: 'member-search', role: 'link', name: 'Member Search', framePath: [] },
        { ref: 'search', role: 'button', name: 'Search', framePath: [] },
        { ref: 'accounts', role: 'link', name: 'Accounts', framePath: [] },
        { ref: 'balance', role: 'button', name: 'Balance Details', framePath: [] },
        ...(state.path.endsWith('/temporary') ? [{ ref: 'retry', role: 'button', name: 'Retry Search', framePath: [] }] : []),
        ...dateControls
      ],
      visibleText: visible,
      dialogs: [], stateFingerprint: `${state.path}|${state.memberId ? 'member-entered' : 'empty'}`
    };
  }

  async resolve(_session: SessionHandle, _target: TargetSpec): Promise<{ count: number; description: string }> { return { count: 1, description: 'unique offline control' }; }

  async act(session: SessionHandle, action: ArtifactAction): Promise<ActionResult> {
    const state = this.state(session);
    if (action.kind === 'fill') {
      const value = typeof action.value === 'string' ? action.value : '';
      const label = action.target.strategies.find((strategy) => strategy.label)?.label;
      if (label === 'Member ID') state.memberId = value;
      if (label === 'Start Date') { state.family = 'transactions'; state.startDate = value; }
      if (label === 'End Date') { state.family = 'transactions'; state.endDate = value; }
      if (label === 'As of Date') { state.family = 'loan'; state.asOfDate = value; }
      return { status: 'succeeded' };
    }
    if (action.kind === 'click') {
      if (action.id === 'open-member-search') state.path = '/servicing/member-search';
      if (action.id === 'submit-member-search') {
        if (state.memberId === '00000') return { status: 'business_outcome', code: 'MEMBER_NOT_FOUND' };
        if (state.memberId === '54321') return { status: 'business_outcome', code: 'PERMISSION_DENIED' };
        if (state.family === 'transactions' && state.startDate >= '2026-10-01') return { status: 'business_outcome', code: 'NO_TRANSACTIONS' };
        if (state.family === 'loan' && state.asOfDate >= '2027-01-01') return { status: 'business_outcome', code: 'UNSUPPORTED_AS_OF_DATE' };
        if (state.memberId === '77777' && !state.transientSeen) { state.transientSeen = true; state.path = '/servicing/temporary'; return { status: 'recoverable', code: 'TEMPORARY_LOAD_FAILURE', message: 'Temporary load failure is visible' }; }
        state.path = state.family === 'transactions' ? '/servicing/transaction-history' : state.family === 'loan' ? '/servicing/loan-payoff' : '/servicing/member-summary';
      }
      if (action.id === 'open-member-result') state.path = '/servicing/member-summary';
      if (action.id === 'open-accounts') state.path = '/servicing/accounts';
      if (action.id === 'open-savings-account') state.path = '/servicing/accounts/savings';
      if (action.id === 'open-balance-details') state.path = '/servicing/balance-details';
      if (action.id === 'retry-search' || action.id.startsWith('recover-')) state.path = state.family === 'transactions' ? '/servicing/transaction-history' : state.family === 'loan' ? '/servicing/loan-payoff' : '/servicing/member-summary';
    }
    return { status: 'succeeded' };
  }

  async extract(session: SessionHandle, spec: { target: TargetSpec; parseAs: 'text' | 'money' | 'string' }): Promise<unknown> {
    const state = this.state(session);
    if (spec.parseAs === 'string') return state.family === 'transactions' ? `Transactions for ${state.startDate} through ${state.endDate}: 2026-09-01 Deposit $100.00; 2026-09-05 Withdrawal $20.00` : 'Transactions';
    return state.family === 'loan' ? { amount: '9876.54', currency: 'USD' } : { amount: '1250.42', currency: 'USD' };
  }

  async captureEvidence(session: SessionHandle): Promise<{ path: string; url: string }> {
    const directory = join(this.options.evidenceRoot ?? join(process.cwd(), 'evidence'), session.id);
    const path = join(directory, `capture-${Date.now()}-${crypto.randomUUID()}.png`);
    await mkdir(directory, { recursive: true });
    await writeFile(path, Buffer.from('offline-synthetic-screenshot'));
    return { path, url: `/api/interventions/${encodeURIComponent(session.id)}/screenshot` };
  }

  async bringToHuman(_session: SessionHandle): Promise<void> {}
  async close(session: SessionHandle): Promise<void> { this.states.delete(session.id); }
}
