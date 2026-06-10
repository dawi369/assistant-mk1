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

## External Error Monitoring

Sentry is the first external exception and trace sink for assistant-mk1.
Cloudflare D1 remains the source of truth for product state, runtime summaries,
audit records, and "what happened?" answers; Sentry is for debugging runtime
failures, regressions, and cross-surface traces.

The current Sentry org/project is:

- Org: `t23`
- Project: `assistant-mk1`

Use one project for the Assistant-MK1 product and distinguish runtime surfaces
with tags instead of creating separate projects too early:

- `runtime.surface=vercel-next` for the Vercel/Next web app and server facade.
- `runtime.surface=cloudflare-worker` for the Cloudflare control plane Worker.
- `runtime.surface=fly-langgraph` for the future Fly/LangGraph workflow runtime.

This keeps issues, releases, and traces in one product view while preserving
easy filters for the surfaces that fail differently. Add more tags when they
represent real operating boundaries, such as `runtime.target`, `workspace.id`,
or a non-sensitive agent/runtime label. Do not send provider keys, WorkOS
secrets, model prompts containing private data, or raw tenant data to Sentry.

Source maps should use `SENTRY_AUTH_TOKEN` only in trusted CI/deploy
environments. Never commit the auth token or print it in logs.

Production Sentry sampling should stay intentionally quiet:

- Production traces default to `0.02` across Vercel and Cloudflare.
- Local development defaults to full tracing so debugging remains easy.
- Browser replay is sampled only on errors in production by default.

Normal request transactions such as `GET /` can still appear under Sentry
traces when they are sampled. Treat those as performance telemetry, not runtime
errors. Unresolved issues remain the primary Sentry view for failures.

## Runtime Traces

Runtime traces are first-party product telemetry stored in Cloudflare D1. They
exist so Admin can answer "what exactly happened?" without digging through
Vercel, Cloudflare, or Sentry logs.

The v0 trace model is:

```txt
RuntimeTrace
  -> RuntimeSpan[]
```

Each span records a compact, redacted step with:

- trace id, span id, and optional parent span id
- layer: browser, Vercel, Cloudflare, D1, provider, executor, or tool
- start, end, duration, and status
- small operational metadata only

Do not store prompts, provider request bodies, auth headers, secrets, full tool
outputs, or raw private data in trace payloads. Large outputs belong in
artifacts. Sensitive failures belong in redacted error summaries plus Sentry
exceptions when useful.

Current traced operations:

- `chat.thread.create`
- `chat.run.stream`
- `tool.url.inspect`
- `diagnostic.demo.inspect` when it can be attached without broad executor
  refactors

Admin uses these D1 traces as the primary in-app request explanation: service
map, waterfall, total duration, and bottleneck span. Sentry remains the
external sampled error/performance system.

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
