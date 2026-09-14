export type GoalEntity = {
  proposedName: string;
  value: string;
  sourceSpan: string;
  type: 'string';
  /** A semantic hint for validation and redaction. It is deliberately open. */
  sensitivity: string;
};

export type GoalOutput = {
  proposedName: string;
  type: 'money' | 'string';
  currency?: string;
};

export type ProvisionalIntent = {
  /** A stable task label supplied by the interpreter/model, not a closed enum. */
  objective: string;
  entities: GoalEntity[];
  requestedOutputs: GoalOutput[];
  risk: 'read_only';
  userGoal: string;
  title?: string;
  requiredConcepts?: string[];
  phrases?: string[];
  businessOutcomes?: string[];
};

export interface GoalInterpreter {
  interpret(userGoal: string, context?: unknown): Promise<ProvisionalIntent>;
}

const WRITE_REQUEST = /\b(?:post|update|change|create|delete|remove|transfer|withdraw|modify)\b|\bdeposit\s+(?:money|funds|cash|a\s+payment)\b|\bsubmit\s+(?:a\s+)?payment\b/i;
const DATE_PATTERN = /\b\d{4}-\d{2}-\d{2}\b/g;
const COMMON_WORDS = new Set([
  'a', 'an', 'and', 'at', 'check', 'find', 'for', 'from', 'get', 'give', 'i', 'in', 'list', 'look', 'lookup',
  'me', 'my', 'of', 'on', 'please', 'show', 'tell', 'the', 'their', 'to', 'up', 'what', 'with'
]);
const NON_IDENTIFIER_WORDS = new Set(['account', 'balance', 'directory', 'details', 'history', 'loan', 'payoff', 'report', 'requests', 'savings', 'status', 'summary', 'transactions']);

type CompatibilityRule = {
  pattern: RegExp;
  objective: string;
  output: GoalOutput;
};

// These labels preserve matching for artifacts created by the original MVP.
// New goals take the generic path below and never select an action recipe.
const COMPATIBILITY_RULES: CompatibilityRule[] = [
  { pattern: /\btransactions?\b|\btransaction\s+history\b/i, objective: 'lookup_member_transaction_history', output: { proposedName: 'transactions', type: 'string' } },
  { pattern: /\bloan\b|\bpayoff\b/i, objective: 'quote_member_loan_payoff', output: { proposedName: 'payoff_quote', type: 'money', currency: 'USD' } },
  { pattern: /\bbalance\b|\bsavings\b/i, objective: 'lookup_member_savings_balance', output: { proposedName: 'current_savings_balance', type: 'money', currency: 'USD' } }
];

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/_+/g, '_').slice(0, 80) || 'read_task';
}

function contentWords(value: string): string[] {
  return value.toLowerCase().match(/[a-z][a-z0-9-]*/g)?.filter((word) => !COMMON_WORDS.has(word) && word.length > 1) ?? [];
}

function assertReadOnlyGoal(userGoal: string): void {
  if (!userGoal.trim()) throw new Error('A plain-language read-only goal is required.');
  if (WRITE_REQUEST.test(userGoal)) {
    throw new Error('This companion only supports read-only requests for member balance and other safe lookups; it cannot post, update, create, delete, or modify records.');
  }
}

function addEntity(entities: GoalEntity[], proposedName: string, value: string, sourceSpan: string, sensitivity: string): void {
  if (!value || entities.some((entity) => entity.proposedName === proposedName || entity.value === value)) return;
  entities.push({ proposedName, value, sourceSpan, type: 'string', sensitivity });
}

function extractEntities(userGoal: string): GoalEntity[] {
  const entities: GoalEntity[] = [];
  // Member/customer/client/user identifiers are common enough to ground
  // explicitly, while the generic labelled form handles account and case IDs.
  const personId = /\b(member|customer|client|user)\s*(?:(?:id|number|no\.?)\s*(?:(?:is|:|#|-)\s*)?)?([A-Za-z0-9][A-Za-z0-9_-]*)/gi;
  for (const match of userGoal.matchAll(personId)) {
    const label = match[1]?.toLowerCase();
    const value = match[2];
    if (value && label && !NON_IDENTIFIER_WORDS.has(value.toLowerCase())) addEntity(entities, `${label === 'member' ? 'member' : label}_id`, value, match[0], label === 'member' ? 'member_identifier' : 'sensitive_identifier');
  }
  const labelledId = /\b(account|case|ticket|order|policy|branch|location)\s+(?:id|number|no\.?|code)\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9_-]*)/gi;
  for (const match of userGoal.matchAll(labelledId)) {
    const label = match[1]?.toLowerCase();
    const value = match[2];
    if (label && value) addEntity(entities, `${label}_id`, value, match[0], label === 'branch' || label === 'location' ? 'plain' : 'sensitive_identifier');
  }
  const directRecordId = /\b(account|case|ticket|order|policy)\s+([A-Za-z0-9][A-Za-z0-9_-]*)/gi;
  for (const match of userGoal.matchAll(directRecordId)) {
    const label = match[1]?.toLowerCase();
    const value = match[2];
    if (label && value && !NON_IDENTIFIER_WORDS.has(value.toLowerCase())) addEntity(entities, `${label}_id`, value, match[0], 'sensitive_identifier');
  }

  // A branch directory/report commonly identifies a city in ordinary prose
  // rather than with an explicit "branch id" label. Preserve that exact span
  // as a plain reusable input; the model still has to ground the corresponding
  // visible filter control during discovery.
  if (/\bbranch\b/i.test(userGoal) && /\b(?:directory|location|report)\b/i.test(userGoal)) {
    const branchCity = /\bbranch(?:\s+(?:directory|location|report))?\s+(?:in|at|for)\s+([A-Za-z][A-Za-z .'-]{1,80}?)(?=\s+(?:and|from|between|with|to)\b|[,.!?]|$)/gi;
    for (const match of userGoal.matchAll(branchCity)) {
      const value = match[1]?.trim();
      if (value && !/^(?:the|a|an)$/i.test(value)) addEntity(entities, 'branch_name', value, value, 'plain');
    }
  }

  const dates = [...userGoal.matchAll(DATE_PATTERN)];
  const hasRange = /\b(?:from|between)\b/i.test(userGoal) && /\b(?:to|and)\b/i.test(userGoal);
  const isPayoffRequest = /\b(?:loan|payoff)\b/i.test(userGoal);
  for (const [index, match] of dates.entries()) {
    const value = match[0];
    const name = (isPayoffRequest || /\bas\s*-?\s*of\b/i.test(userGoal)) && index === 0
      ? 'as_of_date'
      : hasRange ? (index === 0 ? 'start_date' : 'end_date') : `date_${index + 1}`;
    addEntity(entities, name, value, value, 'date');
  }

  // Quoted values are explicit user-provided search terms. They give a
  // generic workflow a safe fromInput reference without guessing from prose.
  for (const match of userGoal.matchAll(/["']([^"']{1,120})["']/g)) {
    const value = match[1]?.trim();
    if (value && !entities.some((entity) => entity.value === value)) addEntity(entities, 'query', value, match[0], 'plain');
  }
  return entities;
}

function compatibilityRule(userGoal: string): CompatibilityRule | undefined {
  const hasMember = /\bmember\b/i.test(userGoal);
  return hasMember ? COMPATIBILITY_RULES.find((rule) => rule.pattern.test(userGoal)) : undefined;
}

function genericOutput(userGoal: string, entities: GoalEntity[]): GoalOutput {
  const withoutValues = withoutEntityValues(userGoal, entities);
  const words = contentWords(withoutValues).filter((word) => !['member', 'customer', 'client', 'user', 'account', 'id', 'number'].includes(word));
  const name = slug(words.slice(-3).join('_'));
  return { proposedName: name === 'read_task' ? 'result' : name, type: 'string' };
}

function withoutEntityValues(userGoal: string, entities: GoalEntity[]): string {
  // Remove complete source spans/values before deriving concepts. Comparing a
  // token with a multi-word entity (for example, "New York") leaves both words
  // behind and makes a changed value fail the learned phrase matcher.
  return entities.reduce((text, entity) => text.replaceAll(entity.sourceSpan, ' ').replaceAll(entity.value, ' '), userGoal);
}

function goalTemplate(userGoal: string, entities: GoalEntity[]): string {
  return entities.reduce((text, entity) => text.replaceAll(entity.value, `{${entity.proposedName}}`), userGoal);
}

function genericTitle(objective: string): string {
  return objective.split('_').filter(Boolean).map((word) => word[0]!.toUpperCase() + word.slice(1)).join(' ') || 'Read-only workflow';
}

export function missingGoalInput(userGoal: string): string | undefined {
  const entities = extractEntities(userGoal);
  if (/\b(?:member|customer|client|user)\b/i.test(userGoal) && !entities.some((entity) => entity.sensitivity === 'sensitive_identifier' || entity.sensitivity === 'member_identifier')) {
    return 'Which member or customer identifier should I use?';
  }
  if (/\b(?:account|case|ticket|order|policy)\s+(?:summary|details?|history|status)\b/i.test(userGoal) && entities.length === 0) {
    return 'Which account, case, ticket, order, or policy identifier should I use?';
  }
  // Balance requests commonly omit the member noun entirely. Ask for the
  // missing identifier conversationally instead of forcing a separate form.
  if (/\b(?:balance|savings)\b/i.test(userGoal) && entities.length === 0) {
    return 'Which member or customer identifier should I use?';
  }
  return undefined;
}

export function interpretGoal(userGoal: string, _context?: unknown): ProvisionalIntent {
  assertReadOnlyGoal(userGoal);
  const entities = extractEntities(userGoal);
  const rule = compatibilityRule(userGoal);
  const objective = rule?.objective ?? slug(contentWords(userGoal).filter((word) => !entities.some((entity) => entity.value.toLowerCase() === word)).slice(0, 6).join('_'));
  const output = rule?.output ?? genericOutput(userGoal, entities);
  const concepts = [...new Set(contentWords(withoutEntityValues(userGoal, entities)))].slice(0, 8);
  return {
    objective,
    entities,
    requestedOutputs: [output],
    risk: 'read_only',
    userGoal,
    title: genericTitle(objective),
    requiredConcepts: concepts,
    phrases: [goalTemplate(userGoal, entities)]
  };
}

export class DeterministicGoalInterpreter implements GoalInterpreter {
  async interpret(userGoal: string, context?: unknown): Promise<ProvisionalIntent> {
    return interpretGoal(userGoal, context);
  }
}

export class ScriptedGoalInterpreter implements GoalInterpreter {
  constructor(private readonly intent: ProvisionalIntent) {}

  async interpret(_userGoal: string, _context?: unknown): Promise<ProvisionalIntent> {
    return this.intent;
  }
}
