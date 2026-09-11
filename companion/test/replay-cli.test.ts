import { describe, expect, it } from 'vitest';
import { parseReplayArgs } from '../src/replay/cli.js';

describe('saved artifact replay CLI', () => {
  it('parses artifact, repeated inputs, target, and headless options', () => {
    expect(parseReplayArgs(['--artifact', 'saved.json', '--input', 'member_id=12345', '--input', 'tenant=demo', '--target', 'http://127.0.0.1:3001', '--headless'])).toEqual({
      artifactPath: 'saved.json', inputs: { member_id: '12345', tenant: 'demo' }, targetUrl: 'http://127.0.0.1:3001', headless: true
    });
  });

  it('rejects missing artifact and malformed input arguments', () => {
    expect(() => parseReplayArgs(['--input', 'member_id=12345'])).toThrow(/--artifact/);
    expect(() => parseReplayArgs(['--artifact', 'saved.json', '--input', 'member_id'])).toThrow(/key=value/);
  });
});
