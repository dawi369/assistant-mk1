# Control Plane API

This document defines operation-level contracts for the future control plane.
It does not define final HTTP routes, D1 tables, R2 object keys, Cloudflare
bindings, or migrations.

Workflow code should depend on repository-style operations, not raw storage.

## Principles

- Every tenant-owned operation takes trusted `scope` first.
- Scope comes from auth/session/trigger context, never from the model.
- Operations return serializable records from the durable contracts.
- The control plane enforces auth, membership, policy, redaction, and audit.
- Fly/LangGraph use mediated APIs first; direct D1/R2 access is a future
  optimization only.

## Workspace Context

`workspaceContext.load(scope, input?)`

Loads the current user, workspace, membership, configured agents, open threads,
and optional app-defined context.

Use for:

- context assembly
- workbench shell
- policy checks
- tool exposure resolver

## Threads

Thread operations should support:

- create thread
- load thread
- list open/recent threads
- update title/status
- archive thread

Thread records are conversation/task continuity. They are not the full runtime
control object; active execution belongs to `RunRecord`.

## Workflow Intents

`workflowIntents.create(scope, input)`

`workflowIntents.updateStatus(scope, input)`

Intents represent typed escalation requests from conversation, schedules,
webhooks, or trusted events.

Create intents before starting complex workflow execution. Do not let external
systems create raw workflow-engine runs without a scoped intent and policy gate.

## Runs

`runs.create(scope, input)`

`runs.updateStatus(scope, input)`

`runs.list(scope, filters)`

Runs represent execution attempts. They track foreground, background, workflow,
and child execution status.

Required use cases:

- show current run state in UI
- associate workflow engine run IDs
- track heartbeat freshness
- manage interrupts and cancellation
- inspect child runs
- link durable outputs

## Lifecycle Events

Initial implementation can persist lifecycle events as `AuditEventRecord`
entries. Promote to a dedicated durable entity only if querying events becomes
concretely painful.

Operation:

- `audit.append(scope, input)` with event name in `action` or `data.eventName`

Events should include:

- actor
- run ID
- workflow intent ID
- tool call ID when relevant
- summary
- redacted metadata

## Decisions

Decision operations:

- create decision record
- list decision records
- supersede decision record

Use for durable reasoning, not every transient thought. Important workflow
outputs and durable beliefs should create or update decisions with provenance.

## Tool Calls

Tool call operations:

- record started
- record finished

Tool calls should store summaries and artifact references, not raw huge logs or
secrets. Large outputs belong in artifact storage.

## Artifacts

Artifact operations:

- create metadata
- create upload URL

R2 or another object store holds blobs. Relational metadata stores ownership,
kind, title, mime type, size, created-by actor, and relationships.

## Managed State

Managed state operations:

- get
- patch

Managed state represents domain assets the agent owns, watches, or explains:
positions, services, tickets, documents, tracked resources, incidents, and
similar app-specific objects.

## Ledger

Ledger operations:

- append
- list

Ledgers capture proposed, simulated, executed, skipped, blocked, reviewed, and
failed actions. Mutation-capable workflows must write ledger entries.

## Triggers

Trigger operations should support:

- create schedule/webhook/event trigger
- pause/resume trigger
- update next trigger time
- record last triggered time
- disable trigger

Trigger wakeups must carry trusted tenant metadata and create workflow intents
before execution.

## Error Shape

Errors should be structured:

```ts
{
  code: string;
  message: string;
  retryable?: boolean;
  redacted?: boolean;
}
```

Do not return secrets, raw credential errors, raw private tool output, or
cross-tenant existence hints.

## Acceptance Criteria

- Every operation that touches tenant data takes trusted scope first.
- External signals resolve to workflow intents before execution.
- Runs can be listed by thread, intent, parent run, and status.
- Tool calls, artifacts, audit events, ledgers, and decisions can be linked back
  to a run.
