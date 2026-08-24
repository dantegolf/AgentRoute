import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { basename, resolve, join } from 'node:path';
import { agentRouteHome } from './config.mjs';

const execFile = promisify(execFileCb);

async function git(repo, args) {
  const { stdout } = await execFile('git', args, { cwd: repo, timeout: 120000, windowsHide: true });
  return stdout.trim();
}

export async function prepareWorkspace({ repo, mode = 'current', taskId }) {
  const root = resolve(repo);
  if (mode === 'current') {
    return { root, mode, cleanup: async () => {}, branch: await safeBranch(root) };
  }
  if (mode !== 'worktree') throw new Error(`Unsupported workspace mode: ${mode}`);

  await git(root, ['rev-parse', '--show-toplevel']);
  const repoKey = createHash('sha1').update(root).digest('hex').slice(0, 10);
  const worktreesRoot = join(agentRouteHome(), 'worktrees', `${basename(root)}-${repoKey}`);
  const worktree = join(worktreesRoot, taskId);
  const branch = `agentroute/${taskId}`;
  await mkdir(worktreesRoot, { recursive: true });
  await git(root, ['worktree', 'add', '-b', branch, worktree, 'HEAD']);
  return {
    root: worktree,
    mode,
    branch,
    cleanup: async ({ remove = false } = {}) => {
      if (remove) await git(root, ['worktree', 'remove', '--force', worktree]);
    },
  };
}

async function safeBranch(repo) {
  try { return await git(repo, ['branch', '--show-current']); } catch { return ''; }
}

export async function workspaceEvidence(root) {
  const result = {};
  for (const [name, args] of Object.entries({
    status: ['status', '--short'],
    diffStat: ['diff', '--stat'],
    diffCheck: ['diff', '--check'],
    diff: ['diff'],
  })) {
    try { result[name] = await git(root, args); } catch (error) { result[name] = `[unavailable] ${error.message}`; }
  }

  try {
    const untracked = (await git(root, ['ls-files', '--others', '--exclude-standard'])).split(/\r?\n/).filter(Boolean);
    result.untracked = [];
    for (const relativePath of untracked.slice(0, 100)) {
      const path = resolve(root, relativePath);
      try {
        const info = await stat(path);
        if (!info.isFile()) continue;
        if (info.size > 500_000) {
          result.untracked.push({ path: relativePath, size: info.size, content: '[omitted: file larger than 500 KB]' });
          continue;
        }
        let content;
        try { content = await readFile(path, 'utf8'); } catch { content = '[binary/unreadable]'; }
        result.untracked.push({ path: relativePath, size: info.size, content: content.slice(0, 200_000) });
      } catch { /* file disappeared while collecting evidence */ }
    }
    result.untrackedCount = untracked.length;
  } catch (error) {
    result.untracked = [];
    result.untrackedCount = 0;
    result.untrackedError = error.message;
  }

  return result;
}
