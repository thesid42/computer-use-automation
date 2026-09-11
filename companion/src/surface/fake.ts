import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ArtifactAction, TargetSpec } from '../artifact/schema.js';
import type { ActionResult, SessionHandle, SurfaceAdapter, SurfaceSnapshot, TargetProfile } from './adapter.js';

type State = { target: TargetProfile; memberId: string; path: string; aborted: boolean };

export class ScriptedDemoSurfaceAdapter implements SurfaceAdapter {
  private readonly states = new Map<string, State>();

  constructor(private readonly options: { evidenceRoot?: string } = {}) {}

  async start(target: TargetProfile): Promise<SessionHandle> {
    const id = `offline-${crypto.randomUUID()}`;
    this.states.set(id, { target, memberId: '', path: '/', aborted: false });
    return { id };
  }

  private state(session: SessionHandle): State {
    const state = this.states.get(session.id);
    if (!state) throw new Error('session_not_found');
    return state;
  }

  async observe(session: SessionHandle): Promise<SurfaceSnapshot> {
    const state = this.state(session);
    return {
      url: new URL(state.path, state.target.url).toString(), title: 'Demo Credit Union · Member Servicing', framePath: [],
      controls: [
        { ref: 'member-search', role: 'link', name: 'Member Search', framePath: [] },
        { ref: 'search', role: 'button', name: 'Search', framePath: [] },
        { ref: 'accounts', role: 'link', name: 'Accounts', framePath: [] },
        { ref: 'balance', role: 'button', name: 'Balance Details', framePath: [] }
      ],
      visibleText: state.path.endsWith('/balance-details') ? 'Balance Details Current Balance $1,250.42' : 'Member Search Accounts',
      dialogs: [], stateFingerprint: `${state.path}|${state.memberId ? 'member-entered' : 'empty'}`
    };
  }

  async resolve(_session: SessionHandle, _target: TargetSpec): Promise<{ count: number; description: string }> { return { count: 1, description: 'unique offline control' }; }

  async act(session: SessionHandle, action: ArtifactAction): Promise<ActionResult> {
    const state = this.state(session);
    if (action.kind === 'fill') {
      state.memberId = typeof action.value === 'string' ? action.value : '';
      return { status: 'succeeded' };
    }
    if (action.kind === 'click') {
      if (action.id === 'open-member-search') state.path = '/servicing/member-search';
      if (action.id === 'submit-member-search') {
        if (state.memberId === '00000') return { status: 'business_outcome', code: 'MEMBER_NOT_FOUND' };
        state.path = '/servicing/member-summary';
      }
      if (action.id === 'open-member-result') state.path = '/servicing/member-summary';
      if (action.id === 'open-accounts') state.path = '/servicing/accounts';
      if (action.id === 'open-savings-account') state.path = '/servicing/accounts/savings';
      if (action.id === 'open-balance-details') state.path = '/servicing/balance-details';
    }
    return { status: 'succeeded' };
  }

  async extract(_session: SessionHandle, _spec: { target: TargetSpec; parseAs: 'text' | 'money' | 'string' }): Promise<unknown> { return { amount: '1250.42', currency: 'USD' }; }

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
