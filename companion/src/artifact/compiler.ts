import type { ProvisionalIntent } from '../goal/interpret.js';
import type { RunEvent } from '../evidence/events.js';
import { redact } from '../evidence/events.js';
import { type CapabilityArtifact, capabilitySchema } from './schema.js';

function persistentTarget(event: RunEvent): { strategies: Array<Record<string, unknown>> } | undefined {
  const action = event.action as { target?: { strategies?: Array<Record<string, unknown>> } } | undefined;
  if (!action?.target) return undefined;
  const control = event.resolvedControl;
  if (!control) {
    const strategies = action.target.strategies?.map((strategy) => Object.fromEntries(Object.entries(strategy).filter(([key]) => key !== 'ref'))).filter((strategy) => Object.keys(strategy).length > 0);
    return strategies?.length ? { strategies: strategies.map((strategy) => redact(strategy) as Record<string, unknown>) } : undefined;
  }
  const strategy: Record<string, unknown> = {};
  // Definition-list values need their label relationship to remain stable.
  // A value such as "$1,250.42" can appear in more than one control on a
  // detail page, while the preceding <dt> label identifies the intended one.
  if (control.relativeText !== undefined) {
    strategy.relativeText = control.relativeText;
    if (control.framePath !== undefined) strategy.framePath = control.framePath;
    if (control.frameUrl !== undefined) strategy.frameUrl = control.frameUrl;
    return { strategies: [redact(strategy) as Record<string, unknown>] };
  }
  for (const key of ['role', 'name', 'text', 'label', 'framePath', 'frameUrl'] as const) {
    const value = control[key];
    if (value !== undefined) strategy[key] = value;
  }
  return { strategies: [redact(strategy) as Record<string, unknown>] };
}

export function compileCapability(intent: ProvisionalIntent, events: RunEvent[], targetProfileId = 'demo-app'): CapabilityArtifact {
  const family = objectiveProfile(intent.objective);
  const artifact: CapabilityArtifact = {
    schemaVersion: 1,
    capabilityId: family.capabilityId,
    version: '1.0.0',
    title: family.title,
    intentSignature: {
      intent: intent.objective, requiredConcepts: family.requiredConcepts, phrases: family.phrases
    },
    inputs: intent.entities.map((entity) => ({ name: entity.proposedName, type: 'string' as const, sensitivity: entity.sensitivity, validation: entity.sensitivity === 'date' ? { minLength: 10, maxLength: 10, format: 'iso_date' as const } : { minLength: 1, maxLength: 64 } })),
    outputs: intent.requestedOutputs.map((output) => ({ name: output.proposedName, type: output.type, ...(output.currency ? { currency: output.currency } : {}) })),
    businessOutcomes: [
      'MEMBER_NOT_FOUND', 'PERMISSION_DENIED', 'ACCOUNT_NOT_FOUND',
      ...(intent.objective === 'lookup_member_transaction_history' ? ['NO_TRANSACTIONS', 'INVALID_START_DATE', 'INVALID_END_DATE', 'INVALID_DATE_RANGE', 'INVALID_DATE'] : []),
      ...(intent.objective === 'quote_member_loan_payoff' ? ['NO_LOAN', 'UNSUPPORTED_AS_OF_DATE', 'INVALID_AS_OF_DATE', 'INVALID_DATE'] : [])
    ],
    risk: 'READ_ONLY',
    policyProfile: {
      allowedOrigins: ['http://localhost:3001', 'http://127.0.0.1:3001'],
      allowedRoutes: ['/', '/servicing*'],
      allowedActionKinds: ['click', 'fill', 'selectOption', 'wait', 'extract', 'finish', 'requestHuman'],
      maxRisk: 'READ_ONLY', controlOwner: 'automation', blockedTargetNamePatterns: ['Post Fee']
    },
    actions: defaultActions(intent.objective),
    preconditions: ['target is on an allowed origin', 'automation owns the session'],
    postconditions: [family.checkpoint],
    waits: { defaultTimeoutMs: 10000, retries: 1 },
    extraction: intent.requestedOutputs.map((output) => ({ output: output.proposedName, actionId: defaultExtractionActionId(intent.objective), parseAs: output.type })),
    finalCheckpoint: family.checkpoint,
    compatibility: { applicationFamily: 'legacy-member-servicing', targetProfileId }
  };
  const successfulFinish = [...events].reverse().find((event) => {
    const action = event.action as { kind?: string; checkpoint?: unknown } | undefined;
    return event.kind === 'action' && event.outcome === 'succeeded' && action?.kind === 'finish' && typeof action.checkpoint === 'string';
  });
  const finishAction = successfulFinish?.action as { checkpoint: string } | undefined;
  if (finishAction) {
    artifact.finalCheckpoint = finishAction.checkpoint;
    artifact.postconditions = [finishAction.checkpoint];
  }
  if (events.length > 0) {
    const seenActionIds = new Set<string>();
    const successful = events.filter((event) => event.kind === 'action' && event.outcome === 'succeeded' && event.action)
      .map((event) => {
        const action = event.action as Record<string, unknown>;
        const actionId = typeof action.id === 'string' ? action.id : undefined;
        if (actionId && seenActionIds.has(actionId)) return undefined;
        if (actionId) seenActionIds.add(actionId);
        const copy = { ...action } as Record<string, unknown>;
        if (copy.kind === 'fill' && typeof copy.value === 'string') {
          const grounded = intent.entities.find((entity) => entity.value === copy.value);
          if (grounded) copy.value = { fromInput: grounded.proposedName };
        }
        if ('target' in copy) {
          const target = persistentTarget(event);
          if (!target) return undefined;
          copy.target = target;
        }
        return copy;
      }).filter((action): action is Record<string, unknown> => action !== undefined);
    artifact.actions = successful as CapabilityArtifact['actions'];
    artifact.extraction = artifact.actions
      .filter((action): action is Extract<CapabilityArtifact['actions'][number], { kind: 'extract' }> => action.kind === 'extract')
      .map((action) => ({ output: action.output, actionId: action.id, parseAs: action.parseAs }));
  }
  return capabilitySchema.parse(artifact);
}

type ObjectiveProfile = {
  capabilityId: string;
  title: string;
  requiredConcepts: string[];
  phrases: string[];
  checkpoint: string;
};

export function objectiveProfile(objective: ProvisionalIntent['objective']): ObjectiveProfile {
  if (objective === 'lookup_member_transaction_history') return {
    capabilityId: 'member.lookup-transaction-history', title: "Look up a member's transaction history", requiredConcepts: ['member', 'transaction', 'history'],
    phrases: ['look up member {member_id} transactions from {start_date} to {end_date}', 'look up member {member_id} and list transactions from {start_date} to {end_date}', 'transaction history for member {member_id} from {start_date} to {end_date}'], checkpoint: 'Transaction History'
  };
  if (objective === 'quote_member_loan_payoff') return {
    capabilityId: 'member.quote-loan-payoff', title: "Get a member's loan payoff quote", requiredConcepts: ['member', 'loan', 'payoff'],
    phrases: ['loan payoff quote for member {member_id} for {as_of_date}', 'get member {member_id} loan payoff quote for {as_of_date}', 'look up member {member_id} and get a loan payoff quote for {as_of_date}'], checkpoint: 'Loan Payoff Quote'
  };
  return {
    capabilityId: 'member.lookup-savings-balance', title: "Look up a member's savings balance", requiredConcepts: ['member', 'savings', 'balance'],
    phrases: ['look up member {member_id} savings balance', 'savings balance for member {member_id}'], checkpoint: 'Current Balance visible'
  };
}

function defaultActions(objective: ProvisionalIntent['objective']): CapabilityArtifact['actions'] {
  const member = { kind: 'fill' as const, id: 'enter-member-id', target: { strategies: [{ label: 'Member ID' }] }, value: { fromInput: 'member_id' }, risk: 'READ_ONLY' as const };
  const search = { kind: 'click' as const, id: 'submit-member-search', target: { strategies: [{ role: 'button', name: 'Search' }] }, risk: 'READ_ONLY' as const };
  if (objective === 'lookup_member_transaction_history') return [
    member,
    { kind: 'fill', id: 'enter-start-date', target: { strategies: [{ label: 'Start Date' }] }, value: { fromInput: 'start_date' }, risk: 'READ_ONLY' },
    { kind: 'fill', id: 'enter-end-date', target: { strategies: [{ label: 'End Date' }] }, value: { fromInput: 'end_date' }, risk: 'READ_ONLY' },
    search,
    { kind: 'extract', id: 'extract-transactions', target: { strategies: [{ text: 'Transactions' }] }, output: 'transactions', parseAs: 'string' },
    { kind: 'finish', id: 'finish-transactions', outputs: ['transactions'], checkpoint: 'Transaction History' }
  ];
  if (objective === 'quote_member_loan_payoff') return [
    member,
    { kind: 'fill', id: 'enter-as-of-date', target: { strategies: [{ label: 'As of Date' }] }, value: { fromInput: 'as_of_date' }, risk: 'READ_ONLY' },
    search,
    { kind: 'extract', id: 'extract-payoff-quote', target: { strategies: [{ text: 'Payoff Quote' }] }, output: 'payoff_quote', parseAs: 'money' },
    { kind: 'finish', id: 'finish-payoff-quote', outputs: ['payoff_quote'], checkpoint: 'Loan Payoff Quote' }
  ];
  return [
    member,
    search,
    { kind: 'wait', id: 'wait-for-results', condition: 'text:Member Search Results', timeoutMs: 10000 },
    { kind: 'click', id: 'open-member-result', target: { strategies: [{ text: 'Member Summary' }] }, risk: 'READ_ONLY' },
    { kind: 'click', id: 'open-accounts', target: { strategies: [{ role: 'link', name: 'Accounts' }, { text: 'Accounts' }] }, risk: 'READ_ONLY' },
    { kind: 'click', id: 'open-savings-account', target: { strategies: [{ text: 'Savings Account' }] }, risk: 'READ_ONLY' },
    { kind: 'click', id: 'open-balance-details', target: { strategies: [{ role: 'button', name: 'Balance Details' }, { text: 'Balance Details' }] }, risk: 'READ_ONLY' },
    { kind: 'extract', id: 'extract-savings-balance', target: { strategies: [{ text: 'Current Balance' }] }, output: 'current_savings_balance', parseAs: 'money' },
    { kind: 'finish', id: 'finish', outputs: ['current_savings_balance'], checkpoint: 'Current Balance visible' }
  ];
}

function defaultExtractionActionId(objective: ProvisionalIntent['objective']): string {
  if (objective === 'lookup_member_transaction_history') return 'extract-transactions';
  if (objective === 'quote_member_loan_payoff') return 'extract-payoff-quote';
  return 'extract-savings-balance';
}
