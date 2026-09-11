import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCompanion } from '../src/app/server.js';

describe('persisted run evidence', () => {
  it('writes sanitized run JSONL, summary, and successful artifact under the injected runtime root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'companion-runtime-'));
    const app = await createCompanion({ offline: true, runtimeDir: root } as never);
    try {
      const created = JSON.parse((await app.inject({ method: 'POST', url: '/api/tasks', payload: { goal: 'Look up member 12345 and tell me their savings balance.' } })).body) as { runId: string };
      const runJsonl = await readFile(join(root, 'evidence', created.runId, 'run.jsonl'), 'utf8');
      const summary = await readFile(join(root, 'evidence', created.runId, 'summary.json'), 'utf8');
      const artifact = await readFile(join(root, 'artifacts', 'member.lookup-savings-balance.json'), 'utf8');
      expect(runJsonl).not.toContain('12345');
      expect(runJsonl).not.toContain('LLM_API_KEY');
      expect(summary).not.toContain('12345');
      expect(artifact).not.toContain('12345');
      expect(summary).toContain('succeeded');
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
