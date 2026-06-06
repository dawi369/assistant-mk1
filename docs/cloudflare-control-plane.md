# Cloudflare Control Plane

Cloudflare is the preferred future live multi-user control plane for Assistant-MK1.

Document status: Cloudflare already owns the current authz/control-plane slice
for users, accounts, workspaces, memberships, active workspace preferences,
workspace-scoped test agents, active agent preferences, demo runs, and the
transitional LangGraph facade. Durable Objects, R2 artifacts, richer policy,
secret custody, customer-facing agent configuration, and production admin flows
are still target work.

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

## LangGraph Facade

The current hosted chat path uses `/langgraph/*` on the Worker as a
LangGraph-compatible facade. Vercel keeps the same browser-facing `/api/*`
contract, but the server-side proxy authenticates to Cloudflare with trusted
dev identity headers. Cloudflare then streams the request to the Fly LangGraph
gateway with the upstream gateway token.

Cloudflare now owns the first chat session boundary invariant: sessions,
LangGraph thread ids, chat intents, policy decisions, and minimal chat run
envelopes are registered in D1 with trusted tenant scope. Thread-scoped facade
requests must match stored ownership before they are proxied to Fly. Streamed
chat runs create an intent, pass through a deterministic dev policy gate, and
then get a minimal Cloudflare run envelope so the control plane can prove a
tenant-scoped request happened without storing the full transcript.

The current dev policy is intentionally small. Chat defaults to `ask`,
`ask`/`dry_run` can pass to Fly, `execute` is blocked until approval policy
exists, and a second same-thread stream is blocked while another run is still
`running`.

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

This is observable control-plane state, not transcript persistence and not the
final Cloudflare-owned conversation stream. The assistant message stream still
passes through the LangGraph-compatible facade while Cloudflare accumulates the
session, policy, run, and event ownership needed to replace that stream later.

This is still not complete production authorization. WorkOS is the hosted web
auth provider, and Cloudflare now owns the first D1-backed membership and agent
routing slices, but explicit invites/admin flows, tool authorization, secret
authorization, and a stronger Vercel-to-Cloudflare trust contract are still
future gates. The durable rule is that Vercel owns the hosted web session,
Cloudflare enforces membership, agent access, session, thread, and run
ownership from trusted scope, and Fly remains the execution plane. The facade
must not expose the Fly token to Vercel or the browser, and it must not become
the permanent product API by accident.
