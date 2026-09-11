import { readFile } from 'node:fs/promises';
import { capabilitySchema } from '../artifact/schema.js';
import { ControlLease } from '../handoff/lease.js';
import { PolicyGate } from '../policy/gate.js';
import { ReplayRunner } from './runner.js';
import { PlaywrightSurfaceAdapter } from '../surface/playwright.js';
import type { RunResult } from '../domain/types.js';

export type ReplayCliOptions = {
  artifactPath: string;
  inputs: Record<string, string>;
  targetUrl?: string;
  headless: boolean;
};

function nextValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

export function parseReplayArgs(argv: string[]): ReplayCliOptions {
  let artifactPath: string | undefined;
  let targetUrl: string | undefined;
  let headless = false;
  const inputs: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--artifact') {
      artifactPath = nextValue(argv, index, '--artifact');
      index += 1;
    } else if (argument === '--input') {
      const assignment = nextValue(argv, index, '--input');
      index += 1;
      const separator = assignment.indexOf('=');
      if (separator <= 0) throw new Error('--input must use key=value');
      const key = assignment.slice(0, separator);
      const value = assignment.slice(separator + 1);
      if (!value) throw new Error('--input must use key=value with a non-empty value');
      inputs[key] = value;
    } else if (argument === '--target') {
      targetUrl = nextValue(argv, index, '--target');
      index += 1;
    } else if (argument === '--headless') {
      headless = true;
    } else if (argument === '--help' || argument === '-h') {
      throw new Error('Usage: npm run replay -- --artifact <path> --input member_id=12345 [--target URL] [--headless]');
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!artifactPath) throw new Error('--artifact is required');
  if (Object.keys(inputs).length === 0) throw new Error('at least one --input key=value is required');
  return { artifactPath, inputs, ...(targetUrl ? { targetUrl } : {}), headless };
}

export async function executeReplayCli(argv: string[]): Promise<{ exitCode: number; output: Record<string, unknown> }> {
  let surface: PlaywrightSurfaceAdapter | undefined;
  let sessionId: { id: string } | undefined;
  try {
    const options = parseReplayArgs(argv);
    const artifact = capabilitySchema.parse(JSON.parse(await readFile(options.artifactPath, 'utf8')));
    const targetUrl = options.targetUrl ?? process.env.TARGET_URL ?? artifact.policyProfile.allowedOrigins[0];
    if (!targetUrl) throw new Error('target URL is required');
    const target = { id: artifact.compatibility.targetProfileId, applicationFamily: artifact.compatibility.applicationFamily, url: targetUrl, headless: options.headless };
    surface = new PlaywrightSurfaceAdapter(process.env.RUNTIME_DIR ? { evidenceRoot: process.env.RUNTIME_DIR } : {});
    const runner = new ReplayRunner(surface, new PolicyGate(artifact.policyProfile), new ControlLease());
    const result = await runner.run(artifact, target, options.inputs);
    sessionId = runner.lastSession;
    const output = { status: result.status, result, llmCalls: 0, artifact: options.artifactPath };
    return { exitCode: result.status === 'failed' ? 1 : 0, output };
  } catch (error) {
    const output = { status: 'failed', error: { code: 'REPLAY_CLI_FAILURE', message: error instanceof Error ? error.message : String(error) } };
    return { exitCode: 1, output };
  } finally {
    if (surface && sessionId) await surface.close(sessionId);
  }
}

export async function runReplayCli(argv: string[]): Promise<number> {
  const result = await executeReplayCli(argv);
  process.stdout.write(`${JSON.stringify(result.output)}\n`);
  return result.exitCode;
}

export type { RunResult };
