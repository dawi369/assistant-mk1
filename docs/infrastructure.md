# Infrastructure

Assistant-MK1 is a reusable agent framework. Infrastructure should support many apps and many users without making Polymancer the only product shape.

## Target Topology

```txt
assistant-ui frontend
  -> conversational control plane
  -> typed intent router
  -> execution policy gate
  -> workflow engine or tool runner
  -> decision records, audit events, artifacts, managed state
```

The frontend streams from the conversational control plane. Fly and LangGraph services do not own the user-facing session; they report progress and results back through Cloudflare-managed state or callbacks.

## Responsibilities

- Frontend: operator cockpit for conversation, state, tools, approvals, artifacts, and run history.
- Conversational control plane: live user/workspace agent coordination, fast answers from canonical state, memory updates, and typed workflow escalation.
- Workflow execution plane: explicit multi-step workflows such as `observe -> analyze -> propose -> execute -> review`.
- Tool runners: server-side execution for CLIs, OSS packages, git submodules, scripts, browser automation, API tools, and heavy jobs.
- Storage: tenant-scoped relational data, per-agent hot state, object artifacts, and workflow backend state.
- Secrets: encrypted, scoped, revocable, server-side only, and available only to approved tools.
- Observability: audit events, tool logs, workflow status, artifacts, heartbeat status, and failure reasons.

## Request Flow

1. A user sends a message or an external event arrives.
2. The runtime derives `userId` and `workspaceId` from authenticated context or trusted trigger metadata.
3. The conversational agent reads scoped canonical state and answers directly when possible.
4. If work needs escalation, the runtime creates a typed `WorkflowIntent`.
5. Policy checks tenant scope, tool permissions, execution mode, approvals, and kill switches.
6. The workflow engine or tool runner executes the approved work.
7. Complex workflows read and write app state through mediated, tenant-scoped Cloudflare APIs first.
8. Outputs are written back as decision records, audit events, artifacts, ledgers, and managed-state updates.
9. Cloudflare streams status and results to the frontend from canonical state.
10. The frontend shows the new state and lets the user inspect why it changed.

Canonical durable entity contracts are defined in `docs/db-contracts.md`. This infrastructure page should describe flow and ownership, not duplicate entity shapes.

## Runtime Split

Cloudflare-style Agents are the preferred future live control plane because they fit stateful multi-user coordination. Fly is the preferred execution plane for heavy tools and LangGraph workflow workers. LangGraph remains important for complex graph-shaped workflows, but it does not have to be the always-on per-user runtime.

The current local/Fly LangGraph starter remains valid for development and staged validation while the target infrastructure is designed.

## Stream Ownership

Cloudflare owns the user-facing stream. The frontend should keep its WebSocket/SSE/HTTP streaming relationship with the conversational control plane. Fly tool runners and LangGraph workflow services should publish progress by calling Cloudflare callbacks or writing scoped status to canonical state that Cloudflare can stream.

This keeps auth, tenant scope, UI state, and cross-user isolation in one place.

## Workflow Data Access

Start with mediated Cloudflare APIs for workflow reads and writes. LangGraph and tool runners should call scoped APIs such as:

- `GET /workspace-context`
- `GET /decision-records`
- `POST /decision-records`
- `POST /audit-events`
- `POST /artifacts`
- `PATCH /managed-state`

Those APIs validate tenant scope, permissions, execution policy, and redaction before touching D1 or R2.

Workflow and tool code should depend on data-client operations, not raw tables. See `docs/db-contracts.md` for the initial operation groups.

Future optimization: scoped direct D1/R2 access from Fly/LangGraph is not part of the initial implementation. It may be considered later only for measured hot paths where mediated APIs create a concrete performance or reliability problem. Even then, direct access must use the same scoped data-client interface, tenant checks, redaction rules, and audit events.

## Reference App Boundary

Polymancer stress-tests the system with trading, secrets, ledgers, triggers, and autonomy. It is a reference mapping only. The same infrastructure must support non-trading agents for deployments, documents, research, tickets, operations, and other workflows.
