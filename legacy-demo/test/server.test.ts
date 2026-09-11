import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = new URL('..', import.meta.url);

async function waitForResponse(port: number, child: ChildProcess): Promise<Response | undefined> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) return undefined;
    try {
      return await fetch(`http://127.0.0.1:${port}/servicing`);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  return undefined;
}

function start(env: NodeJS.ProcessEnv): ChildProcess {
  return spawn(process.execPath, ['--import', 'tsx/esm', 'src/server.ts'], {
    cwd: fileURLToPath(root),
    env,
    stdio: 'ignore',
  });
}

test('standalone server honors HOST and PORT and serves the member UI', async () => {
  const port = 3199;
  const child = start({ ...process.env, HOST: '127.0.0.1', PORT: String(port) });

  try {
    const response = await waitForResponse(port, child);
    assert.ok(response, 'server did not become ready');
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Member Search/);
  } finally {
    child.kill();
  }
});

test('standalone server defaults to companion target port 3001', async () => {
  const port = 3001;
  const child = start({ ...process.env, HOST: '127.0.0.1', PORT: undefined });
  try {
    const response = await waitForResponse(port, child);
    assert.ok(response, 'server did not become ready on default port');
    assert.equal(response.status, 200);
  } finally {
    child.kill();
  }
});
