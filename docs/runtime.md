# Runtime Model

The runtime is split into a conversational control plane and workflow execution plane.

The conversational agent handles fast user interaction: answering from notes/state, explaining current plans, editing memory, inspecting recent activity, and deciding whether a typed workflow intent is needed.

The workflow plane handles explicit multi-step work: tool calls, approvals, execution policy gates, background checks, and durable audit outputs. LangGraph is the preferred engine for complex workflows, but it is not the only possible backend.

assistant-ui remains the UI/runtime substrate for the thread, composer,
messages, stream ergonomics, attachments, and tool-call rendering where those
primitives fit. Assistant-mk1 owns product-level runtime concepts around that
substrate: tenant scope, policy, durable run control, ledgers, managed state,
decision records, and external triggers.

## Workflow Lifecycle

Generic workflow stages:

- `observe`: collect state, events, inputs, or external data.
- `analyze`: compare evidence, reason about options, and update conviction.
- `propose`: create an action proposal, plan, or recommendation.
- `execute`: perform an approved action or dry-run execution.
- `review`: inspect results, update managed state, and write decision records.

Examples:

- Polymancer: observe markets, analyze conviction, propose trade, execute order, review position.
- Deployment agent: observe CI, analyze failure, propose fix, execute deploy, review logs.

## Threads

A thread is the persistent container for a conversation or task. The frontend
currently creates and loads threads through the LangGraph SDK contract, but
hosted simple chat is served by Cloudflare through a compatible `/langgraph`
subset. Long-running workflows should store their continuity in a thread rather
than relying on browser state.

## Runs

A run executes an assistant against a thread. Foreground chat and background work both map to runs. When multiple signals arrive for the same thread, use explicit multitask behavior such as enqueueing rather than racing new work.

In the target architecture, a run is a first-class control-plane record, not
only a workflow-engine implementation detail. A `RunRecord` should connect the
thread, optional workflow intent, execution policy, current status, heartbeat,
interrupt state, external engine run ID, and durable outputs such as tool calls,
artifacts, ledgers, audit events, and decision records.

Run status should be inspectable by the workbench UI. The user should be able to
answer: what is running, what is waiting, what failed, what can be cancelled,
and what durable evidence was produced.

## Child Runs

Delegated or subagent work should become child runs instead of invisible nested
model calls.

Child run rules:

- Child runs inherit trusted tenant scope from the parent runtime.
- Child runs link to `parentRunId` and `rootRunId`.
- Child runs receive a narrowed model-visible tool surface.
- Child run depth is capped by policy/runtime configuration.
- Parent cancellation can cascade to non-durable child runs.
- Durable child runs may outlive the parent only when policy explicitly allows
  it.
- Child results should return as structured summaries plus durable outputs, not
  only prose in the parent transcript.

## Interrupts

Interrupts pause execution and wait for human or external input. They are the correct primitive for approvals, blocked decisions, missing credentials, and user confirmation.

Important rule: code before an interrupt can execute again when resumed. Side effects before interrupts must be idempotent, or they should move after the interrupt.

## Tool Exposure

Tool registration and tool exposure are separate concerns. The platform may know
about many tools, but a given model run should see only the tools allowed for
its tenant scope, agent, workflow stage, execution mode, policy, and child-run
context.

The provisional runtime contract is a tool exposure resolver. It receives the
candidate tools plus scoped run context and returns visibility decisions. This
keeps token cost and risk lower without deleting tools from the installed
library.

## Lifecycle Events

Runtime behavior should emit typed lifecycle events before assistant-mk1 adds
any user-installed hook system.

The canonical event vocabulary is documented in
`docs/observability-and-audit.md` and backed by `LifecycleEventName` in
`lib/agent-framework/contracts.ts`. These events feed audit logs, UI timelines,
policy checks, and future extension points. Arbitrary filesystem hooks are not
part of the first implementation.

## Crons

Recurring starts should create typed workflow intents. In the current starter, cron creation can use the LangGraph Agent Server API. In the target architecture, schedules may live in a Cloudflare-style stateful control plane and escalate to LangGraph or tool runners only when needed.

## External Signals

`POST /api/external-signals` is the current app-level staging ingress for
outside systems. The target architecture routes external events through the
control plane first: derive tenant scope, create a workflow intent, policy-gate
the request, create a run record, execute through LangGraph or Fly, then stream
status from canonical state.

Authentication:

```http
Authorization: Bearer $EXTERNAL_SIGNAL_TOKEN
```

Start or enqueue work:

```json
{
  "action": "start",
  "input": {
    "messages": [{ "role": "user", "content": "Run the nightly project check." }]
  },
  "metadata": {
    "sourceId": "nightly-check"
  }
}
```

Resume interrupted work:

```json
{
  "action": "resume",
  "threadId": "thread-id",
  "command": {
    "resume": { "approved": true }
  }
}
```

Create a cron:

```json
{
  "action": "create_cron",
  "schedule": "0 9 * * 1-5",
  "timezone": "Europe/Prague",
  "input": {
    "messages": [{ "role": "user", "content": "Run the weekday check." }]
  }
}
```

## Persistence

Local development may use the LangGraph dev server's default behavior for
workflow-engine testing. Hosted simple chat should not rely on Fly Machine or
LangGraph dev-server memory. It is Cloudflare-owned and scoped through D1.
Hosted workflow escalation must still verify whether interrupted LangGraph work
survives restart before relying on it.

Production persistence should separate concerns:

- Tenant-scoped relational state for users, workspaces, permissions, ledgers, triggers, audit events, and decision records.
- Per-agent hot state for live conversation/session coordination.
- Object storage for artifacts, logs, traces, reports, and screenshots.
- Workflow engine state for in-flight complex workflows.

See `docs/data-and-state.md` for storage ownership and `docs/infrastructure.md` for the target control-plane/request flow.
