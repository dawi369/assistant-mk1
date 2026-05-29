# Runtime Model

The runtime should use LangGraph's native primitives before introducing a custom scheduler or orchestration layer.

## Threads

A thread is the persistent container for a conversation or task. The frontend creates and loads threads through the LangGraph SDK. Long-running workflows should store their continuity in a thread rather than relying on browser state.

## Runs

A run executes an assistant against a thread. Foreground chat and background work both map to runs. When multiple signals arrive for the same thread, use explicit multitask behavior such as enqueueing rather than racing new work.

## Interrupts

Interrupts pause execution and wait for human or external input. They are the correct primitive for approvals, blocked decisions, missing credentials, and user confirmation.

Important rule: code before an interrupt can execute again when resumed. Side effects before interrupts must be idempotent, or they should move after the interrupt.

## Crons

Recurring starts should use LangGraph cron creation through the Agent Server API. The frontend can expose cron management later, but the first durable seam is the token-protected external signal route.

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

Local development may use the LangGraph dev server's default behavior. Hosted staging must verify whether interrupted work survives restart before relying on it. Production should use durable LangGraph persistence or a database-backed deployment before real long-running jobs depend on it.
