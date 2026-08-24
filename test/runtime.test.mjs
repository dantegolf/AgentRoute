import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { createTaskRecord } from '../src/tasks.mjs';
import { runTask } from '../src/agent/runtime.mjs';

const execFile = promisify(execFileCb);

async function git(cwd, args) { await execFile('git', args, { cwd }); }

async function readJson(req) {
  let text = '';
  for await (const chunk of req) text += chunk;
  return JSON.parse(text || '{}');
}

function send(res, body) {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

test('worker edits repo, records baseline, and finishes in review', async () => {
  const home = await mkdtemp(join(tmpdir(), 'agentroute-home-'));
  process.env.AGENTROUTE_HOME = home;
  const repo = await mkdtemp(join(tmpdir(), 'agentroute-repo-'));
  await git(repo, ['init']);
  await git(repo, ['config', 'user.email', 'test@example.com']);
  await git(repo, ['config', 'user.name', 'Test']);
  await writeFile(join(repo, 'README.md'), '# test\n', 'utf8');
  await git(repo, ['add', 'README.md']);
  await git(repo, ['commit', '-m', 'init']);

  let calls = 0;
  const server = http.createServer(async (req, res) => {
    const body = await readJson(req);
    calls++;
    if (calls === 1) {
      const writeTool = body.tools.find((tool) => tool.function?.name === 'write_file');
      assert.ok(writeTool);
      return send(res, { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'w1', type: 'function', function: { name: 'write_file', arguments: '{"path":"new.txt","content":"worker output\\n"}' } }] } }] });
    }
    assert.ok(body.messages.some((message) => message.role === 'tool' && message.tool_call_id === 'w1'));
    return send(res, { choices: [{ message: { role: 'assistant', content: 'Implemented new.txt and left it for supervisor review.' } }] });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const config = {
      providers: { fake: { protocol: 'openai-chat', baseUrl: `http://127.0.0.1:${port}`, auth: { type: 'none' } } },
      workers: { worker: { provider: 'fake', model: 'fake-model', maxTurns: 4, allowShell: false } },
      defaults: { workspaceMode: 'current' },
    };
    const task = createTaskRecord({ repo, task: 'create new.txt', worker: 'worker', workspaceMode: 'current' });
    const result = await runTask({ task, config });
    assert.equal(result.status, 'review');
    assert.equal(result.baseline.status, '');
    assert.match(result.evidence.status, /\?\? new\.txt/);
    assert.equal(result.evidence.untrackedCount, 1);
    assert.equal(result.evidence.untracked[0].path, 'new.txt');
    assert.equal(result.evidence.untracked[0].content, 'worker output\n');
    assert.equal(await readFile(join(repo, 'new.txt'), 'utf8'), 'worker output\n');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
