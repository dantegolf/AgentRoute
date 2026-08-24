# AgentRoute architecture

AgentRoute separates **supervision** from **implementation**.

## Control plane

The control plane owns provider configuration, worker profiles, task state, workspaces, audit logs and the WebUI. It does not decide whether code is correct.

## Worker runtime

Every worker receives the same normalized coding tools. A provider adapter translates the generic tool loop into the upstream wire protocol.

```text
Generic worker loop
      │
      ├── anthropic-messages ──► Claude / ClaudeGravity / compatible gateways
      ├── openai-chat ─────────► OpenRouter / Gemini compat / Ollama / compatible gateways
      └── openai-responses ────► OpenAI / Omni Router / compatible gateways
```

Adding a new model normally requires only a provider config entry. Adding a genuinely new API shape requires a provider session adapter implementing:

```js
{
  async step(toolResults) {
    return {
      text: 'optional progress/final text',
      toolCalls: [{ id, name, input }],
      done: false
    }
  }
}
```

## Trust boundary

The worker is an untrusted-ish implementer. The supervisor owns acceptance.

A AgentRoute task lifecycle is:

```text
queued → running → review
               ↘ failed
```

There is deliberately no `accepted` state in the worker loop. Acceptance belongs to the external supervisor/user.

## Credentials

Provider configs support:

- `auth.type = "env"` — recommended; config contains only the environment variable name.
- `auth.type = "static"` — intended primarily for local gateways such as ClaudeGravity; the Web API redacts the value.
- `auth.type = "none"` — local/no-auth endpoints.

Browser config updates preserve redacted static secrets instead of overwriting them with the `***` placeholder.

## Isolation

`current` mode is convenient but shares the user's checkout. AgentRoute records baseline git evidence before the worker runs.

`worktree` mode creates a dedicated branch and worktree and is the preferred foundation for parallel workers and later patch acceptance workflows.
