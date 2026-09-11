import { describe, expect, it } from 'vitest';
import { redact, RunEventRecorder } from '../src/evidence/events.js';

describe('evidence', () => {
  it('redacts sensitive member values and records JSONL events', () => {
    const recorder = new RunEventRecorder();
    recorder.record({
      runId: 'run-1', stepId: 'fill', kind: 'action', action: { kind: 'fill', value: '12345' },
      inputProvenance: { fromInput: 'member_id' }, outcome: 'succeeded',
      beforeFingerprint: 'a', afterFingerprint: 'b', evidence: []
    });
    expect(recorder.events[0]?.action).toEqual({ kind: 'fill', value: '[REDACTED]' });
    expect(recorder.toJSONL()).not.toContain('12345');
    expect(redact({ memberId: '12345', nested: ['12345'] })).toEqual({ memberId: '[REDACTED]', nested: ['[REDACTED]'] });
  });
});
