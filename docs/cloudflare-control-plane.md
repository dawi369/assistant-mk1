# Cloudflare Control Plane

Cloudflare is the preferred future live multi-user control plane for assistant-mk1.

Document status: Cloudflare already owns the current authz/control-plane slice
for users, accounts, workspaces, memberships, active workspace preferences,
workspace-scoped test agents, active agent preferences, demo runs, and
Cloudflare-native simple chat behind the LangGraph-compatible browser contract.
Durable Objects, R2 artifacts, richer policy, secret custody, customer-facing
agent configuration, and production admin flows are still target work.

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
- LangGraph-compatible chat facade during the transition from assistant-ui's
  direct LangGraph API shape to a product-specific control-plane API.

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

## Chat Runtime And LangGraph Facade

The current hosted chat path uses `/langgraph/*` on the Worker as a
LangGraph-compatible facade. Vercel keeps the same browser-facing `/api/*`
contract, but the server-side proxy authenticates to Cloudflare with trusted
dev identity headers.

For simple assistant chat, Cloudflare now satisfies the subset of the LangGraph
API shape that assistant-ui uses: thread creation, thread state reads, and
`/runs/stream`. The Worker resolves the trusted user, account, active
workspace, membership, and active agent, records the session/thread/intent/
policy/run state in D1, calls the model provider directly, and streams
LangGraph-compatible SSE chunks back to the browser. Fly is not on the normal
simple-chat path.

Fly/LangGraph remain available as the execution plane for graph-shaped
workflows, heavy tools, browser automation, and future escalation paths. Other
LangGraph-compatible endpoints can still fall through to the Fly gateway when
they are explicitly needed, but that is not the default for a plain message.

The current dev policy is intentionally small. Chat defaults to `ask`,
`ask`/`dry_run` can run through the Cloudflare simple-chat path, `execute` is
blocked until approval policy exists, and a second same-thread stream is
blocked while another run is still `running`.

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

This is observable control-plane state plus lightweight transcript continuity
for the current simple-chat path. It is not the final Agent Runtime Config or
tool-execution model. The durable north star remains: Cloudflare owns the
user-facing conversation/control plane, and Fly executes signed heavy work
only when the control plane escalates to it.

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
