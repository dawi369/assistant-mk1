# Tenancy And Isolation

Multi-user support is a foundation, not an add-on. Every durable object in Assistant-MK1 must be scoped by both `userId` and `workspaceId`.

## Tenant Scope

`TenantScope` is:

```ts
{
  userId: string;
  workspaceId: string;
}
```

This scope applies to:

- Threads and runs.
- Tool permissions and tool calls.
- Secrets and credential references.
- Memory, notes, personality, and decision records.
- Ledgers, managed state, and audit events.
- Triggers, schedules, webhooks, and heartbeats.
- Artifacts, logs, reports, and traces.
- Workflow intents and workflow state.

## Hard Rules

- The model never chooses tenant scope.
- Scope is derived from authenticated request/session context or trusted system trigger metadata.
- Queries must include tenant scope at the storage/access layer, not only in prompts.
- Tool execution receives scope from the runtime and cannot override it.
- Secret lookup requires tenant scope plus tool permission.
- Cross-workspace sharing is denied by default and must be designed as an explicit future capability.

## Failure Modes To Avoid

- Global tool state shared across users.
- Background triggers that wake the wrong workspace.
- Decision records retrieved without tenant filters.
- Artifacts stored under guessable global paths.
- Secrets passed through browser-visible API responses.
- Workflow runners accepting tenant scope from model-generated payloads.

## Acceptance Bar

Before hosted multi-user runtime work is considered ready, two users in two workspaces must be able to run separate agents with separate memories, ledgers, tools, schedules, artifacts, and secrets.
