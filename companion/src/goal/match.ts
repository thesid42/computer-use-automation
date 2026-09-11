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

function phrasePattern(phrase: string): RegExp {
  const tokens = phrase.split(' ');
  const pattern = tokens.map((token) => {
    const slot = /^\{([A-Za-z0-9_]+)\}$/.exec(token);
    return slot?.[1] ? `(?<${slot[1]}>[A-Za-z0-9-]+)` : token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('\\s+');
  return new RegExp(`^${pattern}$`, 'i');
}

function normalize(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9-]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function matches(capability: CapabilitySignature, goal: string): Record<string, string> | undefined {
  const normalizedGoal = normalize(goal);
  const hasConcepts = capability.requiredConcepts.every((concept) => normalizedGoal.includes(normalize(concept)));
  if (!hasConcepts) return undefined;
  for (const phrase of capability.phrases) {
    const normalizedPhrase = phrase.toLowerCase().replace(/[^a-z0-9_{}-]+/g, ' ').trim().replace(/\s+/g, ' ');
    const pattern = phrasePattern(normalizedPhrase);
    const result = pattern.exec(normalizedGoal);
    if (result?.groups) return { ...result.groups };
  }
  const member = /\bmember\s+([A-Za-z0-9-]+)\b/i.exec(goal);
  if (member?.[1]) return { member_id: member[1] };
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
      if (!found) return { kind: 'miss' };
      return { kind: 'match', capability: found.capability, slots: found.slots };
    }
    if (matchesFound.length > 1) return { kind: 'ambiguous', candidates: matchesFound.map((item) => item.capability) };
    if (/savings|balance|member/i.test(goal) && /\bmember\b/i.test(goal) && !/\b[A-Za-z0-9-]+\b/.test(goal.replace(/.*\bmember\b/i, ''))) {
      return { kind: 'clarification', message: 'Please provide the member identifier.' };
    }
    return { kind: 'miss' };
  }
}
