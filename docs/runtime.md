# Runtime Model

The runtime is split into a conversational control plane and workflow execution plane.

The conversational agent handles fast user interaction: answering from notes/state, explaining current plans, editing memory, inspecting recent activity, and deciding whether a typed workflow intent is needed.

The workflow plane handles explicit multi-step work: tool calls, approvals, risk gates, background checks, and durable audit outputs. LangGraph is the preferred engine for complex workflows, but it is not the only possible backend.

## Workflow Lifecycle

Generic workflow stages:

- `observe`: collect state, events, inputs, or external data.
- `analyze`: compare evidence, reason about options, and update conviction.
- `propose`: create an action proposal, plan, or recommendation.
- `execute`: perform an approved action or dry-run execution.
- `review`: inspect results, update managed state, and write decision records.

Examples:

- Polymancer: observe markets, analyze conviction, propose trade, execute order, review position.
- Deployment agent: observe CI, analyze failure, propose fix, execute deploy, review logs.

## Threads

A thread is the persistent container for a conversation or task. The frontend creates and loads threads through the LangGraph SDK. Long-running workflows should store their continuity in a thread rather than relying on browser state.

## Runs

A run executes an assistant against a thread. Foreground chat and background work both map to runs. When multiple signals arrive for the same thread, use explicit multitask behavior such as enqueueing rather than racing new work.

## Interrupts

Interrupts pause execution and wait for human or external input. They are the correct primitive for approvals, blocked decisions, missing credentials, and user confirmation.

Important rule: code before an interrupt can execute again when resumed. Side effects before interrupts must be idempotent, or they should move after the interrupt.

## Crons

Recurring starts should create typed workflow intents. In the current starter, cron creation can use the LangGraph Agent Server API. In the target architecture, schedules may live in a Cloudflare-style stateful control plane and escalate to LangGraph or tool runners only when needed.

## External Signals

`POST /api/external-signals` is the app-level ingress for outside systems.

Authentication:

```http
Authorization: Bearer $EXTERNAL_SIGNAL_TOKEN
```

Start or enqueue work:

```json
{
  "action": "start",
  "input": {
    "messages": [{ "role": "user", "content": "Run the nightly project check." }]
  },
  "metadata": {
    "sourceId": "nightly-check"
  }
}
```

Resume interrupted work:

```json
{
  "action": "resume",
  "threadId": "thread-id",
  "command": {
    "resume": { "approved": true }
  }
}
```

Create a cron:

```json
{
  "action": "create_cron",
  "schedule": "0 9 * * 1-5",
  "timezone": "Europe/Prague",
  "input": {
    "messages": [{ "role": "user", "content": "Run the weekday check." }]
  }
}
```

## Persistence

Local development may use the LangGraph dev server's default behavior. Hosted staging must verify whether interrupted work survives restart before relying on it.

Production persistence should separate concerns:

- Tenant-scoped relational state for users, workspaces, permissions, ledgers, triggers, audit events, and decision records.
- Per-agent hot state for live conversation/session coordination.
- Object storage for artifacts, logs, traces, reports, and screenshots.
- Workflow engine state for in-flight complex workflows.

See `docs/data-and-state.md` for storage ownership and `docs/infrastructure.md` for the target control-plane/request flow.
