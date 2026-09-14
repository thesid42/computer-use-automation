import { describe, expect, it } from 'vitest';
import { CapabilityMatcher } from '../src/goal/match.js';
import { capabilitySchema } from '../src/artifact/schema.js';
import { compileCapability } from '../src/artifact/compiler.js';
import { interpretGoal } from '../src/goal/interpret.js';
import { observedArtifact } from './helpers/fixtures.js';

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

  it('matches multi-word plain inputs while keeping the family concepts stable', () => {
    const branch = {
      intent: 'branch_directory',
      requiredConcepts: ['branch', 'directory'],
      phrases: ['show branch directory in {branch_name}']
    };
    expect(new CapabilityMatcher([branch]).match('Show branch directory in San Jose')).toEqual({
      kind: 'match', capability: branch, slots: { branch_name: 'San Jose' }
    });
    const contact = { intent: 'lookup_contact', requiredConcepts: ['contact'], phrases: ['find contact {contact_name}'] };
    expect(new CapabilityMatcher([contact]).match("Find contact O'Connor")).toEqual({
      kind: 'match', capability: contact, slots: { contact_name: "O'Connor" }
    });
    const intent = interpretGoal('Show the branch directory in New York.');
    expect(intent.entities).toContainEqual(expect.objectContaining({ proposedName: 'branch_name', value: 'New York', sensitivity: 'plain' }));
    expect(intent.requiredConcepts).not.toContain('new');
    expect(intent.requiredConcepts).not.toContain('york');
  });

  it('preserves the exact slot occurrence when it repeats a literal token', () => {
    const lookup = {
      intent: 'lookup_item',
      requiredConcepts: ['find'],
      phrases: ['Find {query}']
    };
    expect(new CapabilityMatcher([lookup]).match('Find FIND')).toEqual({
      kind: 'match', capability: lookup, slots: { query: 'FIND' }
    });
  });
});

describe('capability artifacts', () => {
  it('compiles a versioned artifact without persisting the raw member identifier', () => {
    const intent = interpretGoal('Look up member 12345 and tell me their savings balance.');
    expect(() => compileCapability(intent, [])).toThrow(/CAPABILITY_COMPILE_INVALID/);
    const artifact = observedArtifact(intent);
    expect(() => capabilitySchema.parse(artifact)).not.toThrow();
    expect(JSON.stringify(artifact)).not.toContain('12345');
    expect(artifact.schemaVersion).toBe(1);
    expect(artifact.actions.some((action) => action.kind === 'fill' && typeof action.value === 'object')).toBe(true);
  });
});
