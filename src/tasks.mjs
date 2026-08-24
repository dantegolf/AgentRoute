import { mkdir, readFile, writeFile, readdir, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { agentRouteHome } from './config.mjs';

function tasksDir() { return join(agentRouteHome(), 'tasks'); }
function taskPath(id) { return join(tasksDir(), `${id}.json`); }
function logPath(id) { return join(tasksDir(), `${id}.jsonl`); }

export function createTaskRecord(input) {
  const now = new Date().toISOString();
  return {
    id: randomUUID().slice(0, 8),
    status: 'queued',
    createdAt: now,
    updatedAt: now,
    ...input,
  };
}

export async function saveTask(task) {
  await mkdir(tasksDir(), { recursive: true });
  task.updatedAt = new Date().toISOString();
  await writeFile(taskPath(task.id), `${JSON.stringify(task, null, 2)}\n`, 'utf8');
  return task;
}

export async function appendTaskEvent(id, event) {
  await mkdir(tasksDir(), { recursive: true });
  await appendFile(logPath(id), `${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`, 'utf8');
}

export async function getTask(id) {
  if (!existsSync(taskPath(id))) return null;
  return JSON.parse(await readFile(taskPath(id), 'utf8'));
}

export async function getTaskLog(id) {
  if (!existsSync(logPath(id))) return [];
  return (await readFile(logPath(id), 'utf8')).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

export async function listTasks(limit = 100) {
  if (!existsSync(tasksDir())) return [];
  const files = (await readdir(tasksDir())).filter((file) => file.endsWith('.json') && !file.endsWith('.jsonl'));
  const tasks = [];
  for (const file of files) {
    try { tasks.push(JSON.parse(await readFile(join(tasksDir(), file), 'utf8'))); } catch { /* ignore */ }
  }
  return tasks.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, limit);
}
