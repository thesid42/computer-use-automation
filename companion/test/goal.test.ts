import { describe, expect, it } from 'vitest';
import { interpretGoal } from '../src/goal/interpret.js';

describe('goal interpretation', () => {
  it('preserves exact member-id provenance while normalizing a lookup request', () => {
    const result = interpretGoal('Look up member 12345 and tell me their savings balance.');

    expect(result.objective).toBe('lookup_member_savings_balance');
    expect(result.entities).toContainEqual({
      proposedName: 'member_id',
      value: '12345',
      sourceSpan: 'member 12345',
      type: 'string',
      sensitivity: 'member_identifier'
    });
    expect(result.requestedOutputs[0]).toMatchObject({
      proposedName: 'current_savings_balance',
      type: 'money',
      currency: 'USD'
    });
  });

  it('rejects write-like member requests instead of treating them as balance lookups', () => {
    expect(() => interpretGoal('Post a fee for member 12345')).toThrow(/only supports.*balance|savings/i);
  });
});
