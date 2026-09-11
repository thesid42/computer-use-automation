export type GoalEntity = {
  proposedName: string;
  value: string;
  sourceSpan: string;
  type: 'string';
  sensitivity: 'member_identifier';
};

export type GoalOutput = {
  proposedName: 'current_savings_balance';
  type: 'money';
  currency: 'USD';
};

export type ProvisionalIntent = {
  objective: 'lookup_member_savings_balance';
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
const WRITE_REQUEST = /\b(?:post|fee|update|change|create|delete|remove|transfer|pay|withdraw|deposit|modify)\b/i;

function assertSupportedGoal(userGoal: string): void {
  const readNounPhrase = /^\s*(?:the\s+)?(?:savings\s+)?balance\b/i.test(userGoal);
  if (WRITE_REQUEST.test(userGoal) || !BALANCE_CONCEPT.test(userGoal) || (!READ_REQUEST.test(userGoal) && !readNounPhrase)) {
    throw new Error('This MVP only supports read-only requests to look up a member savings balance.');
  }
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
  return {
    objective: 'lookup_member_savings_balance',
    entities: [{
      proposedName: 'member_id', value, sourceSpan, type: 'string', sensitivity: 'member_identifier'
    }],
    requestedOutputs: [{ proposedName: 'current_savings_balance', type: 'money', currency: 'USD' }],
    risk: 'read_only',
    userGoal
  };
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
