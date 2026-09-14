import type { ProvisionalIntent } from '../../src/goal/interpret.js';
import type { RunEvent } from '../../src/evidence/events.js';
import { compileCapability } from '../../src/artifact/compiler.js';

const target = (strategy: Record<string, unknown>) => ({ strategies: [strategy] });

function event(runId: string, stepId: string, action: Record<string, unknown>, extra: Partial<RunEvent> = {}): RunEvent {
  return { runId, stepId, kind: 'action', action, outcome: 'succeeded', evidence: [], ...extra };
}

export function observedWorkflowEvents(intent: ProvisionalIntent): RunEvent[] {
  const runId = 'fixture-run';
  const member = event(runId, 'enter-member-id', { kind: 'fill', id: 'enter-member-id', target: target({ label: 'Member ID' }), value: intent.entities.find((entity) => entity.proposedName === 'member_id')?.value ?? '12345', risk: 'READ_ONLY' });
  if (intent.objective === 'lookup_member_transaction_history') return [
    member,
    event(runId, 'enter-start-date', { kind: 'fill', id: 'enter-start-date', target: target({ label: 'Start Date' }), value: intent.entities.find((entity) => entity.proposedName === 'start_date')?.value ?? '2026-09-01', risk: 'READ_ONLY' }),
    event(runId, 'enter-end-date', { kind: 'fill', id: 'enter-end-date', target: target({ label: 'End Date' }), value: intent.entities.find((entity) => entity.proposedName === 'end_date')?.value ?? '2026-09-11', risk: 'READ_ONLY' }),
    event(runId, 'submit-member-search', { kind: 'click', id: 'submit-member-search', target: target({ role: 'button', name: 'Search' }), risk: 'READ_ONLY' }),
    event(runId, 'extract-transactions', { kind: 'extract', id: 'extract-transactions', target: target({ text: 'Transactions' }), output: 'transactions', parseAs: 'string' }, { details: { output: 'transactions' } }),
    event(runId, 'finish-transactions', { kind: 'finish', id: 'finish-transactions', outputs: ['transactions'], checkpoint: 'Transaction History' })
  ];
  if (intent.objective === 'quote_member_loan_payoff') return [
    member,
    event(runId, 'enter-as-of-date', { kind: 'fill', id: 'enter-as-of-date', target: target({ label: 'As of Date' }), value: intent.entities.find((entity) => entity.proposedName === 'as_of_date')?.value ?? '2026-09-30', risk: 'READ_ONLY' }),
    event(runId, 'submit-member-search', { kind: 'click', id: 'submit-member-search', target: target({ role: 'button', name: 'Search' }), risk: 'READ_ONLY' }),
    event(runId, 'extract-payoff-quote', { kind: 'extract', id: 'extract-payoff-quote', target: target({ text: 'Payoff Quote' }), output: 'payoff_quote', parseAs: 'money' }, { details: { output: 'payoff_quote' } }),
    event(runId, 'finish-payoff-quote', { kind: 'finish', id: 'finish-payoff-quote', outputs: ['payoff_quote'], checkpoint: 'Loan Payoff Quote' })
  ];
  return [
    member,
    event(runId, 'submit-member-search', { kind: 'click', id: 'submit-member-search', target: target({ role: 'button', name: 'Search' }), risk: 'READ_ONLY' }),
    event(runId, 'wait-for-results', { kind: 'wait', id: 'wait-for-results', condition: 'text:Member Search Results', timeoutMs: 10000 }),
    event(runId, 'open-member-result', { kind: 'click', id: 'open-member-result', target: target({ text: 'Member Summary' }), risk: 'READ_ONLY' }),
    event(runId, 'open-accounts', { kind: 'click', id: 'open-accounts', target: target({ text: 'Accounts' }), risk: 'READ_ONLY' }),
    event(runId, 'open-savings-account', { kind: 'click', id: 'open-savings-account', target: target({ text: 'Savings Account' }), risk: 'READ_ONLY' }),
    event(runId, 'open-balance-details', { kind: 'click', id: 'open-balance-details', target: target({ role: 'button', name: 'Balance Details' }), risk: 'READ_ONLY' }),
    event(runId, 'extract-savings-balance', { kind: 'extract', id: 'extract-savings-balance', target: target({ text: 'Current Balance' }), output: 'current_savings_balance', parseAs: 'money' }, { details: { output: 'current_savings_balance' }, resolvedControl: { relativeText: 'Current Balance', framePath: [] } }),
    event(runId, 'finish', { kind: 'finish', id: 'finish', outputs: ['current_savings_balance'], checkpoint: 'Current Balance visible' })
  ];
}

export function observedArtifact(intent: ProvisionalIntent): ReturnType<typeof compileCapability> {
  return compileCapability(intent, observedWorkflowEvents(intent));
}
