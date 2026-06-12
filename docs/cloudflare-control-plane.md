# Cloudflare Control Plane

Cloudflare is the preferred future live multi-user control plane for assistant-mk1.

Document status: Cloudflare already owns the current authz/control-plane slice
for users, accounts, workspaces, memberships, active workspace preferences,
workspace-scoped test agents, active agent preferences, demo runs, and
Cloudflare Agent-backed normal chat. Durable Object SQLite owns hot per-thread
messages, while D1 remains the product/control-plane source of truth. R2
artifacts, richer policy, secret custody, customer-facing agent configuration,
and production admin flows are still target work.

## Role

Cloudflare should own coordination, not arbitrary heavy execution.

Use it for:

- Live per-user/workspace agent state.
- WebSocket, SSE, or HTTP chat coordination.
- User-facing stream ownership for conversation and workflow progress.
- Run control records for foreground, background, workflow, and child execution
  status.
- Scheduled checks, alarms, and trigger handling.
- Typed workflow intent creation.
- Tenant-scoped reads and writes to app data.
- Policy checks before workflow or tool execution.
- Streaming lightweight results back to the frontend.
- Cloudflare Agents for normal live chat.
- LangGraph-compatible workflow facade only during transition or explicit
  heavy-workflow escalation.

Do not use it as the default place for:

- Arbitrary CLIs.
- Python-heavy workflows.
- Browser automation.
- Long CPU-heavy jobs.
- Git submodules with native dependencies.
- Tool execution that needs a normal Linux container.

Those belong in Fly tool runners or other server-side execution services.

## Storage Mapping

- Durable Object state or Durable Object SQLite: per-agent hot state and coordination.
- D1: relational control data such as users, workspaces, tool registry, permissions, ledgers, triggers, audit events, and decision records.
- R2: artifacts such as logs, reports, traces, screenshots, exports, and research bundles.

R2 is object storage, not a general application database.

The current D1 schema is early-dev and rebuildable. Keep the active schema in
`cloudflare/control-plane/schema.sql` instead of preserving incremental
migration history. The schema starts by dropping current dev tables. If the dev
schema changes incompatibly, rebuild the dev database deliberately with the
current schema.

## Agent Shape

A future Cloudflare Agent should be scoped to a user/workspace/agent identity. It can:

- Load current managed state, notes, memory, and open work.
- Answer simple questions without launching a heavy workflow.
- Create typed `WorkflowIntent` records for complex work.
- Create and update `RunRecord` status, heartbeat, interruption, cancellation,
  and parent/child metadata.
- Wake on schedules or external events.
- Call Fly tool runners through signed server-to-server requests.
- Receive progress callbacks or read workflow status produced by Fly/LangGraph.
- Stream workflow progress and final results to the frontend.
- Record decision records and audit events after work completes.

## Mediated Data APIs

Cloudflare is the owner of app-state reads and writes for the initial implementation. Fly/LangGraph use mediated Cloudflare APIs instead of direct database credentials.

These APIs should expose scoped operations, not raw tables:

- Load workspace context.
- List and create decision records.
- Append audit events.
- Create artifact metadata and upload/sign R2 objects.
- Read and patch managed state.
- Read tool permissions and execution policy.

This keeps tenant isolation below the prompt layer and gives the platform one place to enforce auth, policy, redaction, and audit.

The mediated API should expose data-client operations over the durable entity contracts in `docs/db-contracts.md`; it should not expose raw D1 table access to workflow callers.

Scoped direct storage access from Fly/LangGraph is a future optimization, not a current implementation path.

## Tenant Boundary

Every Cloudflare entry point must derive tenant scope from trusted auth/session/trigger context. The model must not provide `userId` or `workspaceId`.

All D1 queries, R2 object keys, Durable Object IDs, and tool-runner calls must include tenant scope.

The hosted web boundary uses WorkOS AuthKit in Vercel/Next to derive trusted
identity. Vercel maps WorkOS user, account source, and external role/permission
signals into a server-to-server call to Cloudflare. Cloudflare resolves the
internal user, active workspace, membership, and active agent, then enforces
ownership before reading or writing control-plane state. In the current
pre-user dev environment, Cloudflare auto-bootstraps D1-backed user, default
workspace, initial active membership, and default agent rows on first valid
WorkOS-shaped request. Cloudflare then resolves the active workspace and active
agent from D1 preferences, falling back to defaults when no user preference
exists.

Local development can still fall back to server-derived `WORKBENCH_DEV_*`
identity values when WorkOS is not configured. The durable rule is that Worker
storage operations take trusted scope explicitly and executor callbacks resolve
scope from the stored run record.

## Chat Runtime And Agents

The current hosted chat path uses Cloudflare Agents directly. Vercel derives
WorkOS/local identity and calls Cloudflare for the current chat session.
Cloudflare resolves the active workspace, membership, thread, and agent from
D1, mints a short-lived signed Agent token, and returns workspace-scoped recent
threads. The browser uses assistant-ui's AI SDK runtime plus the Cloudflare
Agents React client to connect to one `WorkbenchThreadChatAgent` Durable Object
per resolved thread.

For normal assistant chat, the Agent resolves runtime config and behavior from
the active D1 agent, streams OpenRouter through `AIChatAgent`, persists hot
message state in Durable Object SQLite, and mirrors compact session/thread/run/
trace metadata into D1 for Admin. Browser requests never provide trusted
tenant, workspace, thread, or agent scope.

The latency-sensitive send path should stay small: verify the scoped Agent
token, read cached runtime/behavior config from the Durable Object instance,
write one minimal D1 run-start mirror batch, then start the provider request.
Completion mirrors, trace-detail spans, event writes, and thread-touch updates
should happen after streaming starts or through `waitUntil` where correctness
does not depend on blocking first token. D1 is the source of truth for
authorization and Admin visibility, but normal chat should not perform serial
control-plane writes before contacting OpenRouter.

Fly/LangGraph remain available as the execution plane for graph-shaped
workflows, heavy tools, browser automation, and future escalation paths. Other
LangGraph-compatible endpoints can still exist for transition and explicit
workflow needs, but that is not the default for a plain message.

The current dev policy is intentionally small. Chat defaults to `ask`, Agent
chat is available to active memberships, and mutation-capable tool execution is
blocked until approval policy exists. Duplicate/concurrent message behavior is
handled by the Cloudflare Agent runtime.

Cloudflare also records tenant-scoped control-plane events for session,
thread, intent, policy, and run progress. The current browser-facing workbench
reads those events through Vercel's same-origin facade as a compact activity
feed. The Worker exposes both snapshot reads and a short-lived SSE event stream
for this activity feed, so browser-visible runtime progress can come from
Cloudflare-owned state without exposing Cloudflare credentials or tenant scope
to the browser.

The current implementation also exposes a scoped chat runtime summary:
Cloudflare `GET /chat/runtime-summary` and Vercel
`GET /api/workbench/chat-runtime-summary`. The summary is derived only after
Cloudflare resolves the trusted user, active workspace, membership, and active
agent. It reports the latest session, active or latest owned thread, latest
intent, policy decision, run status/error, recent chat events, and a compact
state such as `no_session`, `thread_ready`, `blocked`, `running`, `failed`, or
`completed`.

This is observable control-plane state plus Durable Object-backed live chat
state. The durable north star remains: Cloudflare owns the user-facing
conversation/control plane, and Fly executes signed heavy work only when the
control plane escalates to it.

## Runtime Traces

Cloudflare D1 is also the first-party runtime trace store. The Worker writes
`runtime_traces` and `runtime_spans` for scoped chat/thread/tool operations so
Admin can answer which service was hit and where latency accumulated.

Current trace kinds:

- `chat.thread.create`
- `chat.agent.stream`
- `chat.run.stream` for the legacy/simple-chat transition path
- `tool.url.inspect`
- `diagnostic.demo.inspect` when it can be attached without broad executor
  refactors

Trace reads are scoped after the same trusted identity resolution as every
other workbench route:

- Cloudflare `GET /runtime/traces/latest?limit=10`
- Cloudflare `GET /runtime/traces/:traceId`
- Vercel `GET /api/workbench/runtime-traces/latest`
- Vercel `GET /api/workbench/runtime-traces/:traceId`

Span payloads must stay compact and redacted. Store operational metadata such
as model id, run id, safe URL summary, duration, status, and error code. Do not
store prompts, auth headers, provider secrets, full provider payloads, or full
tool output in trace data. Tool output belongs in artifacts.

For latency analysis, Agent chat traces should distinguish Worker wall-clock
duration from D1 execution metadata when available. A slow first token should
be attributable to one of the visible stages: token verification, config cache
miss, D1 run-start batch, provider first token, stream duration, or post-stream
D1 mirror work.

## Tool Admin Visibility

The current tool slice is intentionally read-only and Admin-triggered.
Cloudflare exposes `GET /tools` and `POST /tools/runs`, with Vercel facades
under `/api/workbench/tools`. These routes resolve the current user, active
workspace, membership, and active agent before returning tool visibility or
starting a tool run.

`url.inspect` is the first non-demo adapter. It runs in `dry_run` mode under
the `tool-admin-readonly-v0` policy reference, rejects local/private/metadata
targets, performs a bounded public HTTP inspection, and stores the result as
Cloudflare-owned workflow/run/tool-call/artifact/audit/event state. It is not
model-visible yet; model-visible tools wait for the policy layer.

This is still not complete production authorization. WorkOS is the hosted web
auth provider, and Cloudflare now owns the first D1-backed membership and agent
routing slices, but explicit invites/admin flows, tool authorization, secret
authorization, and a stronger Vercel-to-Cloudflare trust contract are still
future gates. The durable rule is that Vercel owns the hosted web session,
Cloudflare enforces membership, agent access, session, thread, and run
ownership from trusted scope, and Fly remains the heavy execution plane. The
facade must not expose the Fly token to Vercel or the browser, and it must not
be mistaken for the final product API.
