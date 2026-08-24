import { createProviderSession } from '../providers/index.mjs';
import { TOOL_DEFINITIONS, createToolRuntime } from './tools.mjs';
import { prepareWorkspace, workspaceEvidence } from '../workspace.mjs';
import { appendTaskEvent, saveTask } from '../tasks.mjs';

function systemPrompt(root) {
  return `You are an implementation worker operating under an external supervisor (usually Codex).\n\nYour job is to implement the assigned task inside the provided workspace. Inspect the existing architecture before editing. Use tools to read and modify files and run relevant tests/lint/typecheck/build. Keep changes focused. Never commit, push, reset --hard, force-clean or publish. Do not merely describe code: implement it. When finished, summarize changed files, checks executed, remaining risks and anything the supervisor must review.\n\nThe supervisor is the final authority and will independently inspect the diff. Workspace root: ${root}`;
}

export async function runTask({ task, config }) {
  const worker = config.workers?.[task.worker];
  if (!worker) throw new Error(`Unknown worker profile: ${task.worker}`);
  const provider = config.providers?.[worker.provider];
  if (!provider) throw new Error(`Unknown provider: ${worker.provider}`);

  task.status = 'running';
  await saveTask(task);
  await appendTaskEvent(task.id, { type: 'task_started', worker: task.worker, provider: worker.provider, model: worker.model });

  const workspace = await prepareWorkspace({ repo: task.repo, mode: task.workspaceMode || config.defaults?.workspaceMode || 'current', taskId: task.id });
  task.workspace = { root: workspace.root, mode: workspace.mode, branch: workspace.branch };
  const baseline = await workspaceEvidence(workspace.root);
  task.baseline = { status: baseline.status, diffStat: baseline.diffStat, diffCheck: baseline.diffCheck, untracked: baseline.untracked };
  await saveTask(task);
  await appendTaskEvent(task.id, { type: 'workspace_baseline', baseline: task.baseline });

  const runTool = createToolRuntime({ root: workspace.root, allowShell: worker.allowShell !== false });
  const session = createProviderSession({ provider, worker, system: systemPrompt(workspace.root), tools: TOOL_DEFINITIONS, task: task.task });
  const maxTurns = Math.min(Math.max(Number(worker.maxTurns || 24), 1), 64);
  let toolResults = null;
  let finalText = '';

  try {
    for (let turn = 1; turn <= maxTurns; turn++) {
      await appendTaskEvent(task.id, { type: 'model_turn', turn, maxTurns });
      const response = await session.step(toolResults);
      if (response.text) {
        finalText = response.text;
        await appendTaskEvent(task.id, { type: 'worker_text', turn, text: response.text });
      }
      if (response.done) break;

      toolResults = [];
      for (const call of response.toolCalls) {
        await appendTaskEvent(task.id, { type: 'tool_call', turn, name: call.name, input: call.input });
        try {
          const output = await runTool(call.name, call.input);
          toolResults.push({ id: call.id, output });
          await appendTaskEvent(task.id, { type: 'tool_result', turn, name: call.name, output: String(output).slice(0, 12000) });
        } catch (error) {
          toolResults.push({ id: call.id, output: error.message, isError: true });
          await appendTaskEvent(task.id, { type: 'tool_error', turn, name: call.name, error: error.message });
        }
      }

      if (turn === maxTurns) throw new Error(`Worker exceeded max turns (${maxTurns}).`);
    }

    const evidence = await workspaceEvidence(workspace.root);
    task.status = 'review';
    task.summary = finalText;
    task.evidence = evidence;
    await saveTask(task);
    await appendTaskEvent(task.id, { type: 'review_required', evidence: { status: evidence.status, diffStat: evidence.diffStat, diffCheck: evidence.diffCheck } });
    return task;
  } catch (error) {
    task.status = 'failed';
    task.error = error.message;
    try { task.evidence = await workspaceEvidence(workspace.root); } catch { /* ignore */ }
    await saveTask(task);
    await appendTaskEvent(task.id, { type: 'task_failed', error: error.message });
    throw error;
  }
}
