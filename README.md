# AgentRoute

**Keep Codex in charge. Hire any model for the implementation.**

AgentRoute is a local, model-agnostic worker control plane for coding supervisors such as Codex. The supervisor keeps responsibility for planning, architecture and final review; AgentRoute gives it a pool of implementation workers backed by any compatible provider.

AgentRoute is deliberately separate from ClaudeGravity. ClaudeGravity can be one worker provider, but AgentRoute can also call Omni Router, OpenRouter, OpenAI, Anthropic, Google Gemini, Ollama, or a custom OpenAI/Anthropic-compatible endpoint.

## What it does

```text
You
 │
 ▼
Codex (supervisor / reviewer)
 │
 ├─ chooses an implementation task
 ├─ writes acceptance criteria
 │
 ▼
AgentRoute
 │
 ├─ worker profile: provider + model + policy
 ├─ current checkout or isolated git worktree
 ├─ workspace-scoped file tools
 ├─ optional shell tool
 ├─ task/event history
 │
 ├────────► ClaudeGravity ─► Gemini / Claude
 ├────────► Omni Router ───► any configured upstream
 ├────────► OpenRouter ─────► model catalog
 ├────────► Gemini API
 ├────────► OpenAI / Anthropic
 └────────► any compatible API
 │
 ▼
status: review + real git evidence
 │
 ▼
Codex independently reviews diff/tests
```

A finished worker task is **never marked as accepted**. AgentRoute finishes at `status: review`; the supervisor must inspect the actual diff and run relevant checks independently.

## MVP features

- Protocol adapters instead of hard-coded model vendors:
  - `anthropic-messages`
  - `openai-chat`
  - `openai-responses` (stateless by default; requests encrypted reasoning context for multi-turn tool use)
- Provider presets for ClaudeGravity, Omni Router, OpenRouter, OpenAI, Anthropic, Gemini API and local Ollama.
- Arbitrary custom compatible providers from WebUI/config.
- Provider model discovery via the standard `/models` endpoint when the upstream exposes it.
- Worker profiles (`provider + model + max turns + shell policy`).
- Common coding tools: read/write/list/search/shell.
- Secrets referenced through environment variables instead of being sent to the browser.
- `current` workspace mode and isolated `git worktree` mode.
- Pre-task worktree baseline plus post-task `git status`, `diff --stat`, `diff --check`, full tracked diff, and captured untracked/new-file evidence.
- Persistent task metadata and JSONL event logs under `~/.agentroute`.
- Local WebUI on `127.0.0.1:19777`.
- Codex skill installer and optional global auto-delegation policy.
- Zero runtime npm dependencies; Node.js 20+ only.

## Requirements

- Node.js 20+
- Git for repository work and worktree isolation
- A model with function/tool calling support

The MVP expects worker models to support function calling. Models without native tool use can be supported later through a separate text-tool adapter.

## Run from source

```bash
git clone https://github.com/dantegolf/AgentRoute.git
cd AgentRoute
npm link
agentroute serve
```

Or without linking:

```bash
node src/cli.mjs serve
```

Open:

```text
http://127.0.0.1:19777/
```

The first run creates:

```text
~/.agentroute/config.json
~/.agentroute/tasks/
~/.agentroute/worktrees/
```

## Configure providers

Provider credentials should normally live in environment variables.

```bash
export OMNIROUTER_API_KEY="omni_..."
export OPENROUTER_API_KEY="..."
export OPENAI_API_KEY="..."
export ANTHROPIC_API_KEY="..."
export GEMINI_API_KEY="..."
```

PowerShell:

```powershell
$env:OMNIROUTER_API_KEY = "omni_..."
$env:OPENROUTER_API_KEY = "..."
```

The WebUI shows whether an expected environment variable is present, but never returns its value.

### Built-in provider presets

| Provider | Protocol | Base URL |
| --- | --- | --- |
| ClaudeGravity | Anthropic Messages | `http://127.0.0.1:18080` |
| Omni Router | OpenAI Responses | `https://api.omnirouter.ru/v1` |
| OpenRouter | OpenAI Chat | `https://openrouter.ai/api/v1` |
| OpenAI | OpenAI Responses | `https://api.openai.com/v1` |
| Anthropic | Anthropic Messages | `https://api.anthropic.com` |
| Google Gemini | OpenAI Chat | `https://generativelanguage.googleapis.com/v1beta/openai` |
| Ollama | OpenAI Chat | `http://127.0.0.1:11434/v1` |

For Omni Router, the correct protocol depends on the token/upstream you configured. The preset targets its Responses interface; you can add another Omni Router provider using `anthropic-messages` or `openai-chat` when appropriate.

For any custom gateway, choose the wire protocol it implements and set its base URL. A compatible model must expose function calling for the coding worker loop.

## Add a worker

Use WebUI → **Workers**, or edit `~/.agentroute/config.json`:

```json
{
  "workers": {
    "fast-gemini": {
      "provider": "gemini",
      "model": "gemini-3.7-flash",
      "maxTurns": 24,
      "allowShell": true
    },
    "deep-claude": {
      "provider": "anthropic",
      "model": "your-claude-model-id",
      "maxTurns": 32,
      "allowShell": true
    }
  },
  "defaults": {
    "worker": "fast-gemini",
    "workspaceMode": "worktree"
  }
}
```

Model IDs are intentionally not hard-coded. Use the exact model ID exposed by the selected provider/account.

## Delegate from the CLI

```bash
agentroute delegate \
  --repo /path/to/project \
  --worker fast-gemini \
  --workspace worktree \
  --task "Implement the agreed retry policy and add regression tests"
```

For longer supervisor-generated tasks:

```bash
agentroute delegate \
  --repo /path/to/project \
  --worker deep-claude \
  --task-file /tmp/agentroute-task.md
```

The returned JSON contains the workspace location, baseline state, worker summary and independent git evidence. `reviewRequired` is always true for a completed implementation.

## Codex integration

Install the global skill:

```bash
agentroute codex install
```

Then explicit prompts can be as natural as:

```text
Отдай реализацию AgentRoute worker fast-gemini, а сам проверь итоговый diff и тесты.
```

or:

```text
Delegate the implementation to AgentRoute using deep-claude. You own final review.
```

Enable optional automatic delegation:

```bash
agentroute codex auto on
```

Disable it:

```bash
agentroute codex auto off
```

The managed global policy tells Codex to delegate only well-bounded implementation work, while retaining architecture, ambiguous debugging, security-sensitive changes and final review itself. Explicit user opt-out always wins.

## Workspace modes

### `current`

Worker edits the currently checked out repository. AgentRoute snapshots the pre-existing status before work so the supervisor can see that the checkout was already dirty.

### `worktree` (recommended)

AgentRoute creates an isolated branch/worktree:

```text
~/.agentroute/worktrees/<repo>-<hash>/<task-id>
branch: agentroute/<task-id>
```

The worker changes only that checkout. The supervisor can review the patch and decide whether/how to integrate it.

## Security model

AgentRoute is a local developer tool, not a security sandbox.

- WebUI binds to loopback by default.
- Browser-facing config redacts static credentials.
- API credentials can be referenced through environment variables.
- Worker shell processes receive a sanitized environment with variables that look like keys/tokens/secrets/passwords/auth credentials removed.
- File tools reject paths and symlinks escaping the workspace.
- Commit/push/hard-reset/force-clean are blocked from the worker shell.
- Worktree isolation reduces accidental damage to the supervisor's checkout.

**Important:** shell access is still ordinary OS process execution and is not a complete filesystem/network sandbox. For untrusted models or repositories, run AgentRoute inside a container/VM or disable shell for the worker profile.

## Project layout

```text
src/
  agent/               generic coding worker loop + tools
  providers/           protocol adapters
  cli.mjs              CLI entry point
  codex.mjs            Codex skill / optional global policy
  config.mjs           provider + worker registry
  server.mjs           loopback control API + WebUI
  tasks.mjs            persistent task/event history
  workspace.mjs        current checkout / git worktree handling
skills/
  agentroute-delegate/   Codex skill
web/                    dependency-free WebUI                   
test/                   core regression tests
```

See [`docs/architecture.md`](docs/architecture.md) for the extension model.

## Roadmap

- Provider model discovery and capability probing.
- Native adapters where compatibility APIs lose useful features.
- Text-tool adapter for models without native function calling.
- Per-worker budgets, timeouts and concurrency limits.
- Parallel workers in isolated worktrees.
- Supervisor repair loops with structured reviewer findings.
- Patch accept/reject/apply from WebUI.
- Stronger sandbox backends (container/OS sandbox).
- Usage/cost accounting by provider/model.
- MCP server so supervisors other than Codex can use the same worker pool.

## License

MIT
