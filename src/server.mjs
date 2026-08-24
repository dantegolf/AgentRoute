import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, mergePublicConfig, publicConfig, saveConfig } from './config.mjs';
import { listProviderModels, protocols } from './providers/index.mjs';
import { createTaskRecord, getTask, getTaskLog, listTasks, saveTask } from './tasks.mjs';
import { runTask } from './agent/runtime.mjs';
import { codexStatus, installCodexSkill, setCodexAutoDelegation } from './codex.mjs';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const running = new Map();

function json(res, status, body) {
  const data = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(data) });
  res.end(data);
}

async function bodyJson(req) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 1_000_000) throw new Error('Request body too large.');
  }
  return data ? JSON.parse(data) : {};
}

function mime(path) {
  return ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' })[extname(path)] || 'application/octet-stream';
}

async function staticFile(reqPath, res) {
  const file = reqPath === '/' ? 'index.html' : reqPath.replace(/^\/+/, '');
  const path = resolve(webRoot, file);
  if (path !== webRoot && !path.startsWith(`${webRoot}${sep}`)) return false;
  try {
    const data = await readFile(path);
    res.writeHead(200, { 'content-type': mime(path), 'content-length': data.length });
    res.end(data);
    return true;
  } catch { return false; }
}

function launch(task, config) {
  if (running.has(task.id)) return;
  const promise = runTask({ task, config }).catch(() => {}).finally(() => running.delete(task.id));
  running.set(task.id, promise);
}

export async function startServer({ host, port } = {}) {
  const initial = await loadConfig();
  host ||= initial.server?.host || '127.0.0.1';
  port ||= Number(initial.server?.port || 19777);

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);
      const path = url.pathname;

      if (path === '/api/health' && req.method === 'GET') return json(res, 200, { ok: true, name: 'AgentRoute', running: running.size });
      if (path === '/api/protocols' && req.method === 'GET') return json(res, 200, protocols);
      const providerModelsMatch = path.match(/^\/api\/providers\/([^/]+)\/models$/);
      if (providerModelsMatch && req.method === 'GET') {
        const config = await loadConfig();
        const provider = config.providers?.[decodeURIComponent(providerModelsMatch[1])];
        if (!provider) return json(res, 404, { error: 'Provider not found' });
        return json(res, 200, await listProviderModels(provider));
      }
      if (path === '/api/config' && req.method === 'GET') return json(res, 200, publicConfig(await loadConfig()));
      if (path === '/api/config' && req.method === 'PUT') {
        const incoming = await bodyJson(req);
        const current = await loadConfig();
        const next = mergePublicConfig(current, incoming);
        await saveConfig(next);
        return json(res, 200, publicConfig(next));
      }
      if (path === '/api/tasks' && req.method === 'GET') return json(res, 200, await listTasks());
      if (path === '/api/tasks' && req.method === 'POST') {
        const input = await bodyJson(req);
        const config = await loadConfig();
        const worker = input.worker || config.defaults?.worker;
        if (!worker) return json(res, 400, { error: 'worker is required (or configure defaults.worker)' });
        if (!input.repo || !input.task) return json(res, 400, { error: 'repo and task are required' });
        const task = createTaskRecord({ repo: resolve(input.repo), task: input.task, worker, workspaceMode: input.workspaceMode || config.defaults?.workspaceMode || 'current' });
        await saveTask(task);
        launch(task, config);
        return json(res, 202, task);
      }
      const taskMatch = path.match(/^\/api\/tasks\/([^/]+)$/);
      if (taskMatch && req.method === 'GET') {
        const task = await getTask(taskMatch[1]);
        return task ? json(res, 200, task) : json(res, 404, { error: 'Task not found' });
      }
      const logMatch = path.match(/^\/api\/tasks\/([^/]+)\/log$/);
      if (logMatch && req.method === 'GET') return json(res, 200, await getTaskLog(logMatch[1]));

      if (path === '/api/codex/status' && req.method === 'GET') return json(res, 200, await codexStatus());
      if (path === '/api/codex/install-skill' && req.method === 'POST') return json(res, 200, { path: await installCodexSkill() });
      if (path === '/api/codex/auto' && req.method === 'POST') {
        const input = await bodyJson(req);
        return json(res, 200, { enabled: Boolean(input.enabled), path: await setCodexAutoDelegation(Boolean(input.enabled)) });
      }

      if (path.startsWith('/api/')) return json(res, 404, { error: 'Not found' });
      if (await staticFile(path, res)) return;
      return json(res, 404, { error: 'Not found' });
    } catch (error) {
      return json(res, 500, { error: error.message });
    }
  });

  await new Promise((resolveListen) => server.listen(port, host, resolveListen));
  console.log(`AgentRoute WebUI: http://${host}:${port}/`);
  return server;
}
