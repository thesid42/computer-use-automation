import { describe, expect, it } from 'vitest';
import { CapabilityMatcher } from '../src/goal/match.js';
import { capabilitySchema } from '../src/artifact/schema.js';
import { compileCapability } from '../src/artifact/compiler.js';
import { interpretGoal } from '../src/goal/interpret.js';

describe('deterministic capability matching', () => {
  const capability = {
    intent: 'lookup_member_savings_balance',
    requiredConcepts: ['member', 'savings', 'balance'],
    phrases: ['look up member {member_id} savings balance', 'savings balance for member {member_id}']
  };

  it('extracts member_id and chooses a unique matching capability without an LLM', () => {
    const result = new CapabilityMatcher([capability]).match('Savings balance for member 12345');
    expect(result).toEqual({ kind: 'match', capability, slots: { member_id: '12345' } });
  });

  it('requests clarification when more than one capability matches', () => {
    const result = new CapabilityMatcher([capability, { ...capability, intent: 'other' }]).match(
      'Look up member 12345 savings balance'
    );
    expect(result.kind).toBe('ambiguous');
  });
});

describe('capability artifacts', () => {
  it('compiles a versioned artifact without persisting the raw member identifier', () => {
    const intent = interpretGoal('Look up member 12345 and tell me their savings balance.');
    const artifact = compileCapability(intent, []);
    expect(() => capabilitySchema.parse(artifact)).not.toThrow();
    expect(JSON.stringify(artifact)).not.toContain('12345');
    expect(artifact.schemaVersion).toBe(1);
    expect(artifact.actions.some((action) => action.kind === 'fill' && typeof action.value === 'object')).toBe(true);
  });
});
