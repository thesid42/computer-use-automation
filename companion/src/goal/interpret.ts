export type GoalEntity = {
  proposedName: string;
  value: string;
  sourceSpan: string;
  type: 'string';
  sensitivity: 'member_identifier' | 'date';
};

export type GoalOutput = {
  proposedName: 'current_savings_balance' | 'transactions' | 'payoff_quote';
  type: 'money' | 'string';
  currency?: 'USD';
};

export type ProvisionalIntent = {
  objective: 'lookup_member_savings_balance' | 'lookup_member_transaction_history' | 'quote_member_loan_payoff';
  entities: GoalEntity[];
  requestedOutputs: GoalOutput[];
  risk: 'read_only';
  userGoal: string;
};

export interface GoalInterpreter {
  interpret(userGoal: string): Promise<ProvisionalIntent>;
}

const MEMBER_PATTERN = /\bmember\s+([A-Za-z0-9-]+)\b/i;
const READ_REQUEST = /\b(?:look\s*up|lookup|get|find|show|tell|retrieve|check|view|see)\b/i;
const BALANCE_CONCEPT = /\b(?:balance|savings)\b/i;
const WRITE_REQUEST = /\b(?:post|fee|update|change|create|delete|remove|transfer|withdraw|deposit|modify)\b/i;
const ISO_DATE_PATTERN = /\b\d{4}-\d{2}-\d{2}\b/g;

function assertSupportedGoal(userGoal: string): void {
  const readNounPhrase = /^\s*(?:the\s+)?(?:savings\s+)?balance\b/i.test(userGoal);
  const transactionRequest = /\btransactions?\b|\btransaction\s+history\b/i.test(userGoal);
  const loanRequest = /\bloan\b|\bpayoff\b/i.test(userGoal);
  if (WRITE_REQUEST.test(userGoal) || (!BALANCE_CONCEPT.test(userGoal) && !transactionRequest && !loanRequest) || (!READ_REQUEST.test(userGoal) && !readNounPhrase && !transactionRequest && !loanRequest)) {
    throw new Error('This companion supports read-only requests for member savings balance, transaction history, and loan payoff quotes.');
  }
}

function dateEntities(userGoal: string): Array<GoalEntity> {
  return [...userGoal.matchAll(ISO_DATE_PATTERN)].map((match, index) => ({
    proposedName: index === 0 ? 'start_date' : 'end_date', value: match[0], sourceSpan: match[0], type: 'string' as const, sensitivity: 'date' as const
  }));
}

export function interpretGoal(userGoal: string): ProvisionalIntent {
  assertSupportedGoal(userGoal);
  const match = MEMBER_PATTERN.exec(userGoal);
  if (!match?.[1]) {
    throw new Error('A member identifier is required, for example “member 12345”.');
  }
  const value = match[1];
  const start = match.index;
  const sourceSpan = userGoal.slice(start, start + match[0].length);
  const memberEntity: GoalEntity = { proposedName: 'member_id', value, sourceSpan, type: 'string', sensitivity: 'member_identifier' };
  const dates = dateEntities(userGoal);
  if (/\btransactions?\b|\btransaction\s+history\b/i.test(userGoal)) {
    if (dates.length < 2) throw new Error('Start and end dates are required, for example “from 2026-09-01 to 2026-09-11”.');
    return { objective: 'lookup_member_transaction_history', entities: [memberEntity, ...dates.slice(0, 2)], requestedOutputs: [{ proposedName: 'transactions', type: 'string' }], risk: 'read_only', userGoal };
  }
  if (/\bloan\b|\bpayoff\b/i.test(userGoal)) {
    if (dates.length < 1) throw new Error('An as-of date is required, for example “for 2026-09-30”.');
    const asOf = { ...dates[0]!, proposedName: 'as_of_date' };
    return { objective: 'quote_member_loan_payoff', entities: [memberEntity, asOf], requestedOutputs: [{ proposedName: 'payoff_quote', type: 'money', currency: 'USD' }], risk: 'read_only', userGoal };
  }
  return { objective: 'lookup_member_savings_balance', entities: [memberEntity], requestedOutputs: [{ proposedName: 'current_savings_balance', type: 'money', currency: 'USD' }], risk: 'read_only', userGoal };
}

export class DeterministicGoalInterpreter implements GoalInterpreter {
  async interpret(userGoal: string): Promise<ProvisionalIntent> {
    return interpretGoal(userGoal);
  }
}

export class ScriptedGoalInterpreter implements GoalInterpreter {
  constructor(private readonly intent: ProvisionalIntent) {}

  async interpret(_userGoal: string): Promise<ProvisionalIntent> {
    return this.intent;
  }
}
