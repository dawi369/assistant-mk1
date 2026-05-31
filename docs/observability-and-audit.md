# Observability And Audit

Observability explains what the agent is doing now. Audit explains what
happened and why after the fact.

Both are product primitives for long-running agent work.

## Mandatory Runtime Signals

Every long-running or tool-using workflow should expose:

- run status
- workflow stage
- heartbeat freshness
- active tool call
- current interrupt or waiting reason
- failure summary
- cancellation availability
- latest durable outputs

The workbench UI should not need to parse model prose to show this state.

## Lifecycle Events

Lifecycle events are the first extension surface.

Initial events:

- `intent.created`
- `run.queued`
- `run.started`
- `run.interrupted`
- `approval.requested`
- `tool.requested`
- `tool.started`
- `tool.finished`
- `artifact.created`
- `decision.created`
- `run.completed`
- `run.failed`
- `run.cancelled`

Events should include scope, actor, run ID, workflow intent ID, target entity,
summary, timestamp, and redacted metadata.

## Audit Events

Audit events are append-only records for important platform, workflow, or tool
activity.

Audit these boundaries:

- external trigger accepted/rejected
- workflow intent created
- run started/completed/failed/cancelled
- interrupt requested/resumed/denied
- policy allowed/blocked
- tool requested/started/finished
- secret access granted/denied
- artifact created
- decision created/superseded
- ledger entry appended
- managed state patched

## Logs Vs Artifacts Vs Audit

- Logs: detailed execution output, often large, often redacted, stored as
  artifacts when useful.
- Artifacts: durable blobs or generated outputs with searchable metadata.
- Audit events: compact immutable facts about important actions.

Do not put huge logs into audit events. Do not rely on artifacts alone for
auditable state changes.

## Redaction

Redact before writing:

- provider keys
- OAuth tokens
- API tokens
- wallet/account credentials
- private user data not needed for the record
- raw prompts when they contain sensitive data
- raw tool output that includes secrets

Audit summaries should be safe for UI display.

## Health And Heartbeats

Health endpoint checks should distinguish:

- web server is up
- LangGraph/Fly execution path is reachable
- data-client backing store is reachable
- artifact store is reachable
- recent run heartbeat is fresh

The current `/api/health` is intentionally lightweight. Production health must
be broader before relying on unattended execution.

## "What Happened?" Query

The agent should answer "what happened?" from:

- run records
- audit events
- tool calls
- artifacts
- ledger entries
- decision records
- managed state changes

The answer should include provenance and freshness. If the durable records are
missing, the answer should say that rather than inventing history.

## Acceptance Criteria

- A completed run can be reconstructed from durable records.
- A failed run has a user-safe failure summary and deeper redacted artifacts
  where needed.
- Policy blocks and approvals are visible in audit history.
- Tool logs are stored as artifacts, not embedded in relational records.
