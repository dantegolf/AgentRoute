#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadConfig, configPath } from './config.mjs';
import { createTaskRecord, saveTask } from './tasks.mjs';
import { runTask } from './agent/runtime.mjs';
import { startServer } from './server.mjs';
import { codexStatus, installCodexSkill, setCodexAutoDelegation } from './codex.mjs';

function parse(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) out._.push(arg);
    else {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i++; }
    }
  }
  return out;
}

function usage() {
  console.log(`AgentRoute — model-agnostic implementation workers\n\nUsage:\n  agentroute serve\n  agentroute delegate --repo <path> --worker <name> --task <text>\n  agentroute delegate --repo <path> --worker <name> --task-file <file>\n  agentroute config\n  agentroute workers\n  agentroute codex install\n  agentroute codex auto on|off\n  agentroute codex status\n`);
}

const args = parse(process.argv.slice(2));
const [command, sub, value] = args._;

if (!command || command === 'help' || args.help) { usage(); process.exit(0); }

if (command === 'serve') {
  await startServer({ host: args.host, port: args.port ? Number(args.port) : undefined });
} else if (command === 'config') {
  await loadConfig();
  console.log(configPath());
} else if (command === 'workers') {
  const config = await loadConfig();
  for (const [id, worker] of Object.entries(config.workers || {})) console.log(`${id}\t${worker.provider}\t${worker.model}`);
} else if (command === 'delegate') {
  const config = await loadConfig();
  const worker = args.worker || config.defaults?.worker;
  let taskText = args.task || '';
  if (args['task-file']) taskText = await readFile(resolve(args['task-file']), 'utf8');
  if (!args.repo || !worker || !taskText.trim()) throw new Error('--repo, worker (or defaults.worker), and task/task-file are required.');
  const task = createTaskRecord({ repo: resolve(args.repo), task: taskText, worker, workspaceMode: args.workspace || config.defaults?.workspaceMode || 'current' });
  await saveTask(task);
  try {
    const result = await runTask({ task, config });
    console.log(JSON.stringify({
      id: result.id,
      status: result.status,
      worker: result.worker,
      workspace: result.workspace,
      summary: result.summary,
      baseline: result.baseline,
      evidence: result.evidence,
      reviewRequired: true,
    }, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
} else if (command === 'codex') {
  if (sub === 'install') console.log(await installCodexSkill());
  else if (sub === 'auto') {
    if (!['on', 'off'].includes(value)) throw new Error('Use: agentroute codex auto on|off');
    console.log(await setCodexAutoDelegation(value === 'on'));
  } else if (sub === 'status') console.log(JSON.stringify(await codexStatus(), null, 2));
  else usage();
} else {
  usage();
  process.exitCode = 2;
}
