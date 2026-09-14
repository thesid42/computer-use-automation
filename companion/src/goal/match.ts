export type CapabilitySignature = {
  intent: string;
  requiredConcepts: string[];
  phrases: string[];
};

export type MatchResult =
  | { kind: 'match'; capability: CapabilitySignature; slots: Record<string, string> }
  | { kind: 'miss' }
  | { kind: 'ambiguous'; candidates: CapabilitySignature[] }
  | { kind: 'clarification'; message: string };

function normalize(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9{}_-]+/g, ' ').trim().replace(/\s+/g, ' ');
}

type NormalizedGoal = { value: string; sourceMap: number[] };

/**
 * Build the matching form while retaining source offsets for captures. The
 * matcher may compare literals case-insensitively and ignore punctuation, but
 * replay inputs must preserve the operator's original value (`O'Connor`,
 * `AB-12`, or a case-sensitive branch code).
 */
function normalizeGoal(input: string): NormalizedGoal {
  const chars: string[] = [];
  const sourceMap: number[] = [];
  let pendingSeparator = -1;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character && /[a-z0-9{}_-]/i.test(character)) {
      if (pendingSeparator >= 0 && chars.length > 0 && chars[chars.length - 1] !== ' ') {
        chars.push(' ');
        sourceMap.push(pendingSeparator);
      }
      chars.push(character.toLowerCase());
      sourceMap.push(index);
      pendingSeparator = -1;
    } else if (chars.length > 0 && chars[chars.length - 1] !== ' ') {
      pendingSeparator = index;
    }
  }
  while (chars[0] === ' ') { chars.shift(); sourceMap.shift(); }
  while (chars[chars.length - 1] === ' ') { chars.pop(); sourceMap.pop(); }
  return { value: chars.join(''), sourceMap };
}

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function phrasePattern(phrase: string): { pattern: RegExp; names: string[] } {
  const tokens = normalize(phrase).split(' ').filter(Boolean);
  const names: string[] = [];
  let source = '^';
  tokens.forEach((token, index) => {
    const slot = /^\{([A-Za-z0-9_]+)\}$/.exec(token);
    if (slot?.[1]) {
      names.push(slot[1]);
      // A slot may contain a multi-word search term. The following literal,
      // when present, bounds it; the final slot consumes the remainder.
      source += index === tokens.length - 1 ? '(.+?)' : '(.+?)';
    } else {
      source += escape(token);
    }
    if (index < tokens.length - 1) source += '\\s+';
  });
  source += '$';
  // Capture indices are required here because searching for a normalized
  // capture with indexOf can select the same text from a literal prefix. For
  // example, `Find {query}` matched against `Find FIND` previously returned
  // `Find` as the query. The `d` flag is supported by the Node runtimes this
  // service targets and gives us the exact group span.
  return { pattern: new RegExp(source, 'id'), names };
}

function hasConcept(goal: string, concept: string): boolean {
  const normalizedGoal = normalize(goal);
  const normalizedConcept = normalize(concept);
  if (!normalizedConcept) return true;
  return normalizedGoal.split(' ').includes(normalizedConcept) || normalizedGoal.includes(` ${normalizedConcept} `) || normalizedGoal.startsWith(`${normalizedConcept} `) || normalizedGoal.endsWith(` ${normalizedConcept}`);
}

function originalCapture(goal: string, normalized: NormalizedGoal, match: RegExpExecArray, capture: string, offset: number): string | undefined {
  if (!capture) return undefined;
  const indexed = match as RegExpExecArray & { indices?: Array<[number, number] | undefined> };
  const range = indexed.indices?.[offset + 1];
  // Node 22 is an explicit runtime requirement, so do not fall back to an
  // indexOf-based approximation: it can silently bind a literal occurrence
  // instead of the actual capture and leak the wrong input into replay.
  if (!range) return undefined;
  const sourceStart = normalized.sourceMap[range[0]];
  const sourceEnd = normalized.sourceMap[range[1] - 1];
  if (sourceStart === undefined || sourceEnd === undefined) return undefined;
  let value = goal.slice(sourceStart, sourceEnd + 1).trim();
  // Quotes are syntax around a value, not part of the reusable input. Keep
  // internal punctuation and casing intact.
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) value = value.slice(1, -1).trim();
  return value || undefined;
}

function matches(capability: CapabilitySignature, goal: string): Record<string, string> | undefined {
  if (!capability.requiredConcepts.every((concept) => hasConcept(goal, concept))) return undefined;
  const normalizedGoal = normalizeGoal(goal);
  for (const phrase of capability.phrases) {
    const { pattern, names } = phrasePattern(phrase);
    const result = pattern.exec(normalizedGoal.value);
    if (!result) continue;
    const slots: Record<string, string> = {};
    names.forEach((name, index) => {
      const value = originalCapture(goal, normalizedGoal, result, result[index + 1] ?? '', index);
      if (value) slots[name] = value;
    });
    if (names.every((name) => slots[name] !== undefined)) return slots;
  }
  return undefined;
}

export class CapabilityMatcher {
  constructor(private readonly capabilities: CapabilitySignature[]) {}

  match(goal: string): MatchResult {
    const matchesFound = this.capabilities.flatMap((capability) => {
      const slots = matches(capability, goal);
      return slots ? [{ capability, slots }] : [];
    });
    if (matchesFound.length === 1) {
      const found = matchesFound[0];
      return found ? { kind: 'match', capability: found.capability, slots: found.slots } : { kind: 'miss' };
    }
    if (matchesFound.length > 1) return { kind: 'ambiguous', candidates: matchesFound.map((item) => item.capability) };
    if (/\b(?:member|customer|client|user|account|case|ticket|order|policy)\b/i.test(goal) && !/\b(?:member|customer|client|user|account|case|ticket|order|policy)\s+(?:id|number|no\.?)?\s*[A-Za-z0-9]/i.test(goal)) {
      return { kind: 'clarification', message: 'Please provide the identifier needed for this request.' };
    }
    return { kind: 'miss' };
  }
}
