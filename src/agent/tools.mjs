import { readFile, writeFile, readdir, stat, lstat, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, relative, dirname, sep } from 'node:path';
import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execCb);

export const TOOL_DEFINITIONS = [
  {
    name: 'read_file',
    description: 'Read a UTF-8 text file inside the assigned workspace.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' }, start_line: { type: 'integer' }, end_line: { type: 'integer' } },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Create or fully replace a UTF-8 text file inside the assigned workspace.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list_files',
    description: 'List files/directories inside a workspace path.',
    input_schema: { type: 'object', properties: { path: { type: 'string' } } },
  },
  {
    name: 'search_text',
    description: 'Search literal text recursively inside workspace files. Skips dependencies/build outputs.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string' }, path: { type: 'string' }, max_results: { type: 'integer' } },
      required: ['query'],
    },
  },
  {
    name: 'shell',
    description: 'Run a shell command in the workspace. Use for tests, lint, builds, git diff/status and inspection. Never commit, push, hard-reset or force-clean.',
    input_schema: {
      type: 'object',
      properties: { command: { type: 'string' }, timeout_ms: { type: 'integer' } },
      required: ['command'],
    },
  },
];

function insideRoot(root, path) {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..');
}

function sanitizedEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/KEY|TOKEN|SECRET|PASSWORD|AUTH|CREDENTIAL/i.test(key)) continue;
    env[key] = value;
  }
  return env;
}

export function createToolRuntime({ root, allowShell = true }) {
  root = resolve(root);
  if (!existsSync(root)) throw new Error(`Workspace does not exist: ${root}`);

  async function safePath(input, allowMissing = false) {
    const abs = resolve(root, input || '.');
    if (!insideRoot(root, abs)) throw new Error(`Path escapes workspace: ${input}`);

    const rel = relative(root, abs);
    if (!rel) return abs;

    let current = root;
    for (const part of rel.split(sep).filter(Boolean)) {
      current = resolve(current, part);
      try {
        const info = await lstat(current);
        if (info.isSymbolicLink()) throw new Error(`Symlink paths are not allowed inside workspace: ${input}`);
      } catch (error) {
        if (allowMissing && error?.code === 'ENOENT') return abs;
        throw error;
      }
    }
    return abs;
  }

  return async function runTool(name, input = {}) {
    if (name === 'read_file') {
      const path = await safePath(input.path);
      const text = await readFile(path, 'utf8');
      if (!input.start_line && !input.end_line) return text.slice(0, 200000);
      const lines = text.split(/\r?\n/);
      const start = Math.max(1, Number(input.start_line || 1));
      const end = Math.min(lines.length, Number(input.end_line || lines.length));
      return lines.slice(start - 1, end).map((line, index) => `${start + index}: ${line}`).join('\n');
    }

    if (name === 'write_file') {
      const path = await safePath(input.path, true);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, String(input.content), 'utf8');
      return `Wrote ${relative(root, path)} (${Buffer.byteLength(String(input.content), 'utf8')} bytes)`;
    }

    if (name === 'list_files') {
      const path = await safePath(input.path || '.');
      const entries = await readdir(path, { withFileTypes: true });
      return entries.slice(0, 500).map((entry) => `${entry.isDirectory() ? 'dir ' : 'file'} ${entry.name}`).join('\n');
    }

    if (name === 'search_text') {
      const base = await safePath(input.path || '.');
      const query = String(input.query);
      const max = Math.min(Math.max(Number(input.max_results || 100), 1), 300);
      const skip = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.venv', 'venv', 'target', 'coverage', '.agentroute']);
      const results = [];
      async function walk(dir) {
        if (results.length >= max) return;
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          if (results.length >= max) break;
          if (skip.has(entry.name) || entry.isSymbolicLink()) continue;
          const path = resolve(dir, entry.name);
          if (!insideRoot(root, path)) continue;
          if (entry.isDirectory()) { await walk(path); continue; }
          try {
            if ((await stat(path)).size > 2_000_000) continue;
            const lines = (await readFile(path, 'utf8')).split(/\r?\n/);
            for (let index = 0; index < lines.length && results.length < max; index++) {
              if (lines[index].includes(query)) results.push(`${relative(root, path)}:${index + 1}: ${lines[index].slice(0, 500)}`);
            }
          } catch { /* ignore binary/unreadable */ }
        }
      }
      await walk(base);
      return results.join('\n') || 'No matches.';
    }

    if (name === 'shell') {
      if (!allowShell) throw new Error('Shell is disabled for this worker profile.');
      const command = String(input.command || '');
      if (/\bgit\s+(push|commit|reset\s+--hard|clean\s+-[^\n]*f)/i.test(command)) {
        throw new Error('Blocked destructive/publishing git command. The supervisor owns commit/push/reset/clean.');
      }
      if (/\b(rm|del|rmdir)\b[^\n]*(\/|\\)(\.\.|~|Users|home|etc|Windows)/i.test(command)) {
        throw new Error('Blocked suspicious destructive path operation outside the workspace.');
      }
      const timeout = Math.min(Math.max(Number(input.timeout_ms || 120000), 1000), 600000);
      try {
        const { stdout, stderr } = await exec(command, {
          cwd: root,
          timeout,
          maxBuffer: 4 * 1024 * 1024,
          windowsHide: true,
          env: sanitizedEnv(),
        });
        return `${stdout}${stderr ? `\n[stderr]\n${stderr}` : ''}`.slice(0, 300000);
      } catch (error) {
        return `exit/error: ${error.message}\nstdout:\n${error.stdout || ''}\nstderr:\n${error.stderr || ''}`.slice(0, 300000);
      }
    }

    throw new Error(`Unknown tool: ${name}`);
  };
}
