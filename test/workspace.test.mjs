import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { prepareWorkspace } from '../src/workspace.mjs';

const execFile = promisify(execFileCb);
async function git(cwd, args) { const { stdout } = await execFile('git', args, { cwd }); return stdout.trim(); }

test('worktree mode creates an isolated task branch', async () => {
  process.env.AGENTROUTE_HOME = await mkdtemp(join(tmpdir(), 'agentroute-worktrees-'));
  const repo = await mkdtemp(join(tmpdir(), 'agentroute-source-'));
  await git(repo, ['init']);
  await git(repo, ['config', 'user.email', 'test@example.com']);
  await git(repo, ['config', 'user.name', 'Test']);
  await writeFile(join(repo, 'a.txt'), 'base\n');
  await git(repo, ['add', 'a.txt']);
  await git(repo, ['commit', '-m', 'init']);

  const workspace = await prepareWorkspace({ repo, mode: 'worktree', taskId: 'test1234' });
  assert.notEqual(workspace.root, repo);
  assert.equal(workspace.branch, 'agentroute/test1234');
  assert.equal(await git(workspace.root, ['branch', '--show-current']), 'agentroute/test1234');
  await workspace.cleanup({ remove: true });
});
