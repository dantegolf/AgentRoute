import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createToolRuntime } from '../src/agent/tools.mjs';

test('filesystem tools cannot escape the workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentroute-tools-'));
  await writeFile(join(root, 'ok.txt'), 'hello', 'utf8');
  const run = createToolRuntime({ root, allowShell: false });
  assert.equal(await run('read_file', { path: 'ok.txt' }), 'hello');
  await run('write_file', { path: 'nested/new/file.txt', content: 'created' });
  assert.equal(await run('read_file', { path: 'nested/new/file.txt' }), 'created');
  await assert.rejects(() => run('read_file', { path: '../outside.txt' }), /escapes workspace/);
  await assert.rejects(() => run('shell', { command: 'echo no' }), /Shell is disabled/);
});
