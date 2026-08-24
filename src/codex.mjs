import { chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const START = '<!-- AGENTROUTE_AUTO_DELEGATION_START -->';
const END = '<!-- AGENTROUTE_AUTO_DELEGATION_END -->';

const AUTO_POLICY = `## AgentRoute automatic delegation

AgentRoute is available as an external implementation-worker pool. You are the supervisor and final reviewer.

- If the user explicitly asks to delegate to another model, AgentRoute, Gemini, Claude, OpenRouter, Omni Router, or a worker, use the agentroute-delegate skill.
- You may automatically delegate a well-bounded implementation, test-writing, repetitive refactor, migration, or narrowly specified bug fix when a configured AgentRoute worker is suitable.
- Prefer doing architecture decisions, ambiguous debugging, security-sensitive changes, final review, and tiny edits yourself.
- If the user says not to delegate / do it yourself / no workers, do not use AgentRoute.
- Never trust a worker summary as proof. Independently inspect git status/diff and run relevant checks before accepting changes.
`;

function sourceSkill() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'agentroute-delegate', 'SKILL.md');
}

export async function installCodexSkill() {
  const source = sourceSkill();
  const target = join(homedir(), '.agents', 'skills', 'agentroute-delegate', 'SKILL.md');
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
  await chmod(target, 0o644);
  return target;
}

function mergeBlock(existing, enabled) {
  const start = existing.indexOf(START);
  const end = existing.indexOf(END);
  if ((start >= 0) !== (end >= 0) || (start >= 0 && end < start)) throw new Error('Incomplete AgentRoute managed block in global AGENTS file.');
  let cleaned = existing;
  if (start >= 0) cleaned = `${existing.slice(0, start)}${existing.slice(end + END.length)}`.trimEnd();
  if (!enabled) return `${cleaned}${cleaned ? '\n' : ''}`;
  const block = `${START}\n${AUTO_POLICY.trim()}\n${END}`;
  return `${cleaned}${cleaned ? '\n\n' : ''}${block}\n`;
}

export async function setCodexAutoDelegation(enabled) {
  const codexHome = resolve(process.env.CODEX_HOME || join(homedir(), '.codex'));
  const override = join(codexHome, 'AGENTS.override.md');
  const agents = join(codexHome, 'AGENTS.md');
  const target = existsSync(override) && (await readFile(override, 'utf8')).trim() ? override : agents;
  const existing = existsSync(target) ? await readFile(target, 'utf8') : '';
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, mergeBlock(existing, enabled), 'utf8');
  return target;
}

export async function codexStatus() {
  const skill = join(homedir(), '.agents', 'skills', 'agentroute-delegate', 'SKILL.md');
  const codexHome = resolve(process.env.CODEX_HOME || join(homedir(), '.codex'));
  const candidates = [join(codexHome, 'AGENTS.override.md'), join(codexHome, 'AGENTS.md')];
  let auto = false;
  let agentsPath = candidates[1];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const text = await readFile(path, 'utf8');
    if (text.includes(START) && text.includes(END)) { auto = true; agentsPath = path; break; }
  }
  return { skillInstalled: existsSync(skill), skillPath: skill, autoDelegation: auto, agentsPath };
}
