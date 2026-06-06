# Infrastructure

Assistant-MK1 is a reusable agent framework. Infrastructure should support many apps and many users without making Polymancer the only product shape.

Document status: this page intentionally compares the current hosted dev
baseline with the target runtime. Use `docs/deployment-vercel.md` and
`docs/dev-infrastructure-readiness.md` as runbooks.

## Target Topology

```txt
browser
  -> Vercel Next.js app
  -> WorkOS AuthKit session via the Next SDK
  -> Vercel server facade derives trusted user/account identity and external membership signals
  -> Cloudflare control plane over a server-to-server boundary
  -> active workspace, membership, agent access, and policy checks
  -> typed intent router
  -> run control record
  -> Fly LangGraph workflow or tool runner
  -> decision records, audit events, artifacts, managed state
```

Vercel owns the hosted web session and browser ergonomics. Cloudflare owns
authorization, user/workspace/agent-scoped state, policy, run control, and
canonical writes. Fly and LangGraph services do not own the user-facing
session; they report progress and results back through Cloudflare-managed state
or callbacks.

## Current Dev Baseline vs Target Runtime

The current hosted dev baseline is intentionally split but not fully at the north-star runtime yet:

- Vercel hosts the Next.js frontend and same-origin browser API facade.
- WorkOS AuthKit runs at the Vercel boundary for hosted sign-in. Vercel maps
  WorkOS user identity and, when present, WorkOS organization identity into
  trusted account/workspace headers for Cloudflare. Organization-backed
  accounts get one default workspace in the current slice; the north star
  allows multiple workspaces per organization later. The current personal
  workspace fallback exists for pre-user development and possible future solo
  use.
- Cloudflare owns the production-shaped workbench run-control path and now
  serves simple hosted chat through a LangGraph-compatible `/langgraph` subset,
  with D1-backed tenant ownership for chat sessions, thread ids, lightweight
  transcript continuity, chat intents, policy decisions, run envelopes, and
  control-plane activity events.
- Fly runs the LangGraph runtime gateway and signed executor endpoints for
  heavy workflow/tool execution and explicit escalation.

assistant-ui still talks to a LangGraph-compatible API for chat threads and
streaming, but normal hosted chat is now answered by Cloudflare directly.
Treat the facade as a compatibility boundary for the current UI substrate, not
the final product API. The current boundary enforces trusted dev tenant
ownership for sessions and thread-scoped calls, applies a small dev policy, and
keeps Fly out of the simple-message path. The workbench can read recent
Cloudflare activity through a same-origin Vercel facade and can subscribe to a
short-lived Cloudflare-backed event stream for live activity updates. It is not
a frontend auth system.

The north-star runtime keeps WorkOS AuthKit at the Vercel web boundary, then
moves user-facing conversation and workflow progress streaming behind the
Cloudflare control plane. Fly remains the execution plane for LangGraph
workflows and heavy tools, and writes durable outputs back through mediated
Cloudflare APIs or callbacks.

## Responsibilities

- Frontend: operator cockpit for conversation, state, tools, approvals, artifacts, and run history.
- Conversational control plane: live user/workspace agent coordination, fast answers from canonical state, memory updates, and typed workflow escalation.
- Workflow execution plane: explicit multi-step workflows such as `observe -> analyze -> propose -> execute -> review`.
- Run control: durable status, heartbeat, parent/child ownership, interrupts, cancellation, and recovery metadata for active and historical executions.
- Tool runners: server-side execution for CLIs, OSS packages, git submodules, scripts, browser automation, API tools, and heavy jobs.
- Storage: tenant-scoped relational data, per-agent hot state, object artifacts, and workflow backend state.
- Secrets: encrypted, scoped, revocable, server-side only, and available only to approved tools.
- Observability: audit events, tool logs, workflow status, artifacts, heartbeat status, and failure reasons.

## Request Flow

1. A user sends a message or an external event arrives.
2. Vercel derives WorkOS user, account id, and safe external membership signals
   from the server session, or a trusted trigger supplies equivalent metadata.
3. Cloudflare resolves `userId`, `accountId`, `workspaceId`, membership, and
   active agent from that trusted context.
4. The conversational agent reads scoped canonical state and answers directly when possible.
5. If work needs escalation, the runtime creates a typed `WorkflowIntent`.
6. Policy checks tenant scope, membership, agent access, tool permissions,
   execution mode, approvals, and kill switches.
7. The runtime creates or updates a `RunRecord` for the execution attempt.
8. The workflow engine or tool runner executes the approved work.
9. Complex workflows read and write app state through mediated, tenant-scoped Cloudflare APIs first.
10. Outputs are written back as decision records, audit events, artifacts, ledgers, and managed-state updates.
11. Cloudflare streams run status and results to the frontend from canonical state.
12. The frontend shows the new state and lets the user inspect why it changed.

Canonical durable entity contracts are defined in `docs/db-contracts.md`. This infrastructure page should describe flow and ownership, not duplicate entity shapes.

## Runtime Split

Cloudflare-style Agents are the preferred future live control plane because they fit stateful multi-user coordination. Fly is the preferred execution plane for heavy tools and LangGraph workflow workers. LangGraph remains important for complex graph-shaped workflows, but it does not have to be the always-on per-user runtime.

The current Vercel/Fly LangGraph path remains valid for development and staged validation while the Cloudflare-owned conversational control plane is built.

## Stream Ownership

Cloudflare owns the user-facing stream. The frontend should keep its WebSocket/SSE/HTTP streaming relationship with the conversational control plane. Fly tool runners and LangGraph workflow services should publish progress by calling Cloudflare callbacks or writing scoped status to canonical state that Cloudflare can stream.

This keeps auth, tenant scope, UI state, and cross-user isolation in one place.

The current implementation has the first pieces of this: a tenant-scoped
control-plane event stream for runtime progress and a Cloudflare-owned
simple-chat stream behind the LangGraph-compatible browser contract. Fly is
reserved for graph-shaped workflow execution and heavy tools.

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

## Tool Exposure

The durable tool registry can contain more tools than a single model run should
see. Before a workflow or child run starts, the control plane should resolve the
model-visible tool surface from tenant scope, agent configuration, tool
permissions, workflow stage, execution mode, policy, and delegation context.

This resolver is a policy boundary, not just prompt decoration. It reduces
token cost, narrows risk, and gives the UI a concrete explanation for why a tool
was exposed or hidden.

## Lifecycle Events

The first extension surface should be typed lifecycle events, not arbitrary
shell hooks. Events such as `run.started`, `tool.finished`, and
`approval.requested` should drive audit records, UI history, policy checks, and
future hook/plugin decisions.

## Reference App Boundary

Polymancer stress-tests the system with market workflows, secrets, ledgers, triggers, and autonomy. It is a reference mapping only. The same infrastructure must support deployments, documents, research, tickets, operations, and other agent workflows.
