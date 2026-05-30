# Cloudflare Control Plane

Cloudflare is the preferred future live multi-user control plane for Assistant-MK1.

## Role

Cloudflare should own coordination, not arbitrary heavy execution.

Use it for:

- Live per-user/workspace agent state.
- WebSocket, SSE, or HTTP chat coordination.
- User-facing stream ownership for conversation and workflow progress.
- Scheduled checks, alarms, and trigger handling.
- Typed workflow intent creation.
- Tenant-scoped reads and writes to app data.
- Policy checks before workflow or tool execution.
- Streaming lightweight results back to the frontend.

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

## Agent Shape

A future Cloudflare Agent should be scoped to a user/workspace/agent identity. It can:

- Load current managed state, notes, memory, and open work.
- Answer simple questions without launching a heavy workflow.
- Create typed `WorkflowIntent` records for complex work.
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
