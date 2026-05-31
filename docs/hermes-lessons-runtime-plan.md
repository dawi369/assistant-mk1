# Hermes Lessons Runtime Plan

This is a temporary implementation plan for applying useful Hermes architecture
lessons to Assistant-MK1 without turning this project into a local harness
clone.

Hermes and Assistant-MK1 are different products. Hermes is a strong open agent
harness with local session infrastructure. Assistant-MK1 is aiming at a hosted,
multi-user agent workbench with a conversational control plane, typed workflow
escalation, Cloudflare-owned coordination, and Fly/LangGraph execution planes.

The goal is to borrow the durable runtime lessons while preserving the product
architecture already documented in this repo.

## Lessons To Adopt

- Treat active execution as infrastructure, not as a chat transcript detail.
- Separate broad tool registration from the narrow tool surface exposed to a
  model run.
- Model delegated work as child workflow runs with explicit ownership, not as
  invisible nested prompts.
- Use typed lifecycle events for policy, audit, UI history, and future
  extension points before adding arbitrary plugin or shell hooks.
- Make context assembly explicit and grounded in durable records, artifacts,
  managed state, and current run state.

## Phase 1: Runtime Control Records

Add a provisional `RunRecord` contract as the hosted-product equivalent of a
session-control object.

It should connect:

- `ThreadRecord`
- `WorkflowIntentRecord`
- external workflow engine run IDs, such as LangGraph run IDs
- active status and heartbeat timestamps
- current interrupt or approval state
- parent and child run relationships
- tool calls, artifacts, ledgers, audit events, and decision records

This record should not imply a table schema, migration, Cloudflare binding, or
LangGraph storage implementation. It is a contract for the state Assistant-MK1
must be able to represent.

## Phase 2: Child Workflow Semantics

Delegated work should become explicit child runs.

Default behavior:

- A child run has a `parentRunId`.
- A child run inherits tenant scope from the parent.
- A child run receives a narrowed tool surface.
- A child run has a depth limit enforced by policy/runtime code.
- Cancellation can cascade from parent to child.
- Child results return as structured summaries and durable outputs.
- Child work may outlive the parent only when marked durable by policy.

This avoids the common failure mode where subagent work exists only inside the
parent call path and cannot be inspected, cancelled, resumed, or audited.

## Phase 3: Tool Exposure Resolver

Tool registration and tool exposure are separate concerns.

The durable tool registry can know about a broad tool library. A resolver should
decide what the model can see for a specific run based on:

- tenant scope
- agent and workspace configuration
- workflow intent and stage
- execution mode and policy
- tool permission records
- child-run or delegation restrictions
- platform/runtime constraints

The resolver should return a narrowed tool set plus human-readable explanation
metadata for debugging and UI inspection.

## Phase 4: Lifecycle Events Before Hooks

Do not add arbitrary user-installed filesystem hooks yet. Start with internal
typed lifecycle events that can feed audit logs, policy checks, UI timelines,
and future extension points.

Initial event names:

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

Hooks can be considered later after the trust model is explicit.

## Phase 5: Explicit Context Assembly

Define a context assembly boundary before implementing compression.

Suggested context tiers:

- Stable: agent identity, project rules, and enabled tool guidance.
- Scoped: trusted workspace, project, thread, and active run state.
- Retrieved: decision records, managed state, ledgers, artifacts, and audit
  summaries.
- Volatile: current time, provider/model metadata, active interrupt state, and
  recent lifecycle events.

Summaries remain indexes, not truth. Answers about why something happened should
retrieve durable records and linked artifacts.

## Phase 6: External Signal Hardening

The current `/api/external-signals` route is a staging ingress. The target path
is:

```txt
external event
  -> authenticated control-plane ingress
  -> derive tenant scope from trusted context
  -> create WorkflowIntent
  -> policy gate
  -> create RunRecord
  -> execute through LangGraph or Fly
  -> write audit, artifact, ledger, and decision records
  -> stream status from the control plane
```

The model never supplies tenant scope. The browser never receives secrets.

## Non-Goals

- Do not copy Hermes SQLite persistence directly.
- Do not make LangGraph the always-on multi-user session owner by accident.
- Do not build universal provider abstraction before the runtime needs it.
- Do not add arbitrary filesystem hooks before the trust model is designed.
- Do not add Cloudflare resources, D1 migrations, or R2 bindings in this slice.

## First Implementation Slice

This slice should remain docs-and-contracts only:

- Add provisional run/execution contracts.
- Document parent/child run semantics.
- Add tool exposure resolver contracts.
- Add lifecycle event vocabulary.
- Update the architecture graph so the control object is visible.

Runtime implementation, persistence, Cloudflare resources, migrations, and tool
execution wiring come later.
