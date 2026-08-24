---
name: agentroute-delegate
description: Delegate a well-bounded coding implementation task from Codex to an external AgentRoute worker backed by Claude, Gemini, OpenRouter, Omni Router, OpenAI, Anthropic, ClaudeGravity, or another configured compatible API. Use when the user explicitly asks to delegate/use another model/worker, or when automatic delegation is enabled and an implementation subtask is suitable for a worker. Codex remains planner, supervisor, and final reviewer.
---

# AgentRoute delegation

Use AgentRoute as an implementation worker pool, never as the final authority.

## Explicit triggers

Delegate when the user asks for AgentRoute, a worker, Gemini, Claude, OpenRouter, Omni Router, or says to delegate implementation. If the user says to do it yourself / not to delegate / no workers, do not invoke AgentRoute.

## Procedure

1. Inspect enough of the repository to understand the task and existing architecture.
2. Decide the acceptance criteria yourself.
3. Choose a configured worker with `agentroute workers`. If the user named a worker/model and a matching profile exists, use it.
4. Write a precise task file. Include goal, relevant context, requirements, verification expectations, and scope limits. Do not ask the worker to commit or push.
5. Run:

   `agentroute delegate --repo <repo> --worker <worker> --task-file <task-file>`

6. Treat `status: review` as "implementation finished, review required", not as success.
7. Independently inspect `git status`, the full `git diff`, all untracked/new files reported by AgentRoute, and `git diff --check` in the reported workspace. Run relevant tests/lint/typecheck/build yourself.
8. If the implementation has concrete defects, delegate a focused repair task that lists reviewer findings. Normally stop after two repair rounds and take over if the worker cannot converge.
9. You own final acceptance and all commits/pushes.

## Automatic delegation guidance

Good candidates: feature implementation after design is clear, tests, boilerplate, repetitive refactors, migrations, and well-isolated bug fixes.

Poor candidates: architecture decisions, ambiguous root-cause investigation, security-sensitive work, destructive operations, tiny edits, and final review.

## Safety

AgentRoute's filesystem tools are workspace-scoped, but shell is not a full OS sandbox. Prefer worker profiles with worktree isolation for untrusted models and do not expose unnecessary secrets in the worker environment.
