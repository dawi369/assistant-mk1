# Cloudflare Control Plane

Cloudflare is the live multi-user control plane for assistant-mk1. It owns
coordination, authorization, normal chat session state, policy, and canonical
control-plane writes. It does not own arbitrary heavy execution.

Document status: Cloudflare currently owns users, accounts, workspaces,
memberships, active workspace preferences, workspace-scoped agents, active
agent preferences, normal chat coordination, Admin summaries, diagnostic runs,
tool policy, approvals, runtime traces, and control-plane events. Secret
custody, customer-facing admin flows, mutation-capable tools, and richer
artifact storage remain target work.

## Responsibilities

Use Cloudflare for:

- Trusted user/workspace/agent authorization.
- User-facing chat/session coordination.
- Cloudflare Agents normal live chat.
- D1-backed run, policy, tool, audit, trace, and event records.
- Durable Object session snapshots and per-thread hot state.
- Typed workflow intent creation.
- Tool exposure and execution policy.
- Scoped callbacks from Fly/LangGraph.
- Browser-visible runtime summaries and live-session events.

Do not use Cloudflare as the default runtime for arbitrary CLIs, Python-heavy
workflows, browser automation, long CPU-heavy jobs, native dependencies, or
tools that need a normal Linux container. Those belong in Fly tool runners or
other server-side execution services.

## Storage

- Durable Object state / Durable Object SQLite: session coordination and hot
  per-thread messages.
- D1: relational product/control-plane state: users, workspaces, memberships,
  agents, preferences, chat/control runs, tool permissions, approvals, audit
  events, traces, and events.
- R2: future artifacts such as logs, reports, screenshots, exports, and
  research bundles.

The current D1 schema is early-dev and rebuildable. Keep the active schema in
`cloudflare/control-plane/schema.sql`; it intentionally starts by dropping dev
tables. Rebuild local or remote D1 only when deliberately resetting dev state.

## Tenant Boundary

Every Cloudflare entry point must derive tenant scope from trusted
auth/session/trigger context. The model and browser must not provide trusted
`userId`, `workspaceId`, `threadId`, or `agentId`.

Hosted web requests use WorkOS AuthKit in Vercel/Next. Vercel maps WorkOS
user, account source, and external role/permission signals into a
server-to-server Cloudflare call. Cloudflare resolves the internal user, active
workspace, membership, and active agent before reading or writing state.

Local development can fall back to server-derived `WORKBENCH_DEV_*` identity
only when `WORKBENCH_ALLOW_LOCAL_DEV_IDENTITY=true` and the runtime is not
production. Hosted production fails closed if WorkOS is incomplete.

## Chat Runtime

Normal hosted chat uses Cloudflare Agents directly:

```txt
Vercel session facade
  -> Cloudflare resolves active workspace/member/agent/thread
  -> WorkbenchSessionAgent returns session snapshot and short-lived token
  -> browser connects to WorkbenchThreadChatAgent
  -> Agent streams OpenRouter and mirrors compact metadata to D1
```

The latency-sensitive message path should stay small: verify the scoped Agent
token, read cached runtime/behavior config from the Durable Object, write the
minimal D1 run-start mirror, then contact OpenRouter. Completion mirrors,
trace spans, event writes, and thread-touch updates should happen after
streaming starts or through `waitUntil` when correctness allows it.

Fly/LangGraph remain available for graph-shaped workflows, heavy tools,
browser automation, and explicit escalation. They should not be the default
path for a plain message.

## Live Session Events

The browser-visible workbench state converges on the scoped
`WorkbenchSessionAgent` stream:

- Cloudflare: `GET /chat/session/stream`
- Vercel facade: `GET /api/workbench/chat-session/stream`

The stream can emit compact `session.snapshot`, thread create/activate/refresh
events, chat run lifecycle events, tool updates, trace updates, and Admin
summary invalidation. Payloads are hints over canonical D1 and Durable Object
state; they must exclude tokens, prompts, secrets, raw provider payloads, and
full tool output.

Tool runners and future Fly/LangGraph workflows should publish progress by
calling scoped Cloudflare callbacks that update D1 first, then notify the
matching session Agent. The browser should not subscribe to Fly directly for
product/runtime state.

## Runtime Traces

D1 is the first-party runtime trace store. The Worker writes `runtime_traces`
and `runtime_spans` for scoped chat/thread/tool operations so Admin can answer
which service was hit and where latency accumulated.

Current trace kinds:

- `chat.thread.create`
- `chat.agent.stream`
- `chat.run.stream` for legacy/simple-chat transition paths
- `tool.url.inspect`
- `diagnostic.demo.inspect` when it can be attached without broad executor
  refactors

Trace reads are scoped after the same identity resolution as every other
workbench route:

- Cloudflare `GET /runtime/traces/latest?limit=10`
- Cloudflare `GET /runtime/traces/:traceId`
- Vercel `GET /api/workbench/runtime-traces/latest`
- Vercel `GET /api/workbench/runtime-traces/:traceId`

Trace payloads must stay compact and redacted. Store operational metadata such
as model id, run id, safe URL summary, duration, status, and error code. Do not
store prompts, auth headers, provider secrets, full provider payloads, or full
tool output.

## Tools And Policy

The current tool slice is read-only and Admin-triggered. Cloudflare exposes
`GET /tools`, `POST /tools/runs`, `POST /tools/policy`, and scoped approval
routes; Vercel facades live under `/api/workbench/tools`.

`url.inspect` is the first non-demo adapter. It runs in `dry_run` mode, rejects
local/private/metadata targets, performs bounded public HTTP inspection, and
stores Cloudflare-owned workflow/run/tool-call/artifact/audit/event state. It
can become model-visible only by explicit owner/admin policy opt-in for the
current user/workspace/agent permission row, and exposure stays blocked when
approval is required or the tool is disabled.

`demo.inspect` remains registered as diagnostic compatibility for the original
Cloudflare-owned run slice. It is not editable through Admin and should not be
treated as the model for future production tools.

Generic policy evaluates execution modes, approval state, model exposure, kill
switches, allowlists, denylists, cooldowns, hourly limits, max runtime, and max
artifact bytes. Approval-required `url.inspect` validates safe input, persists
an interrupted run and requested approval, then waits for Admin approve/deny.

## Trust Boundary

Vercel owns hosted web session resolution. Cloudflare owns membership, agent
access, session, thread, tool, and run ownership from trusted scope. Normal
facade requests may be signed with a shared server-side secret; Cloudflare
verifies signature metadata before trusting forwarded identity headers.

The facade must not expose Fly tokens, provider keys, tool credentials, or
tenant scope to the browser. Fly remains the heavy execution plane and reports
progress back through Cloudflare-owned state.
