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

## Current Implementation Status

- Hosted Vercel uses WorkOS AuthKit as the sign-in boundary.
- Vercel maps WorkOS `user.id` to internal `userId`.
- Vercel maps WorkOS `organizationId` to internal `workspaceId` when present.
- During pre-user development, signed-in WorkOS sessions without an
  organization fall back to a stable `workos-personal:<user-id>` workspace.
- Vercel forwards trusted tenant headers to the Cloudflare Worker; browser
  requests never provide tenant ids directly.
- Cloudflare auto-bootstraps D1-backed user, workspace, active membership, and
  default active agent rows for the current pre-user dev environment.
- Hosted WorkOS traffic resolves the active default agent in Cloudflare instead
  of forwarding `WORKBENCH_DEV_AGENT_ID`.
- Local development may fall back to `WORKBENCH_DEV_USER_ID` and
  `WORKBENCH_DEV_WORKSPACE_ID` plus `WORKBENCH_DEV_AGENT_ID` when WorkOS is not
  configured.

WorkOS sign-in is implemented, but production authorization is not complete.
Richer role policy, explicit workspace administration, tool permissions, and
secret access policy remain production gates.

## Failure Modes To Avoid

- Global tool state shared across users.
- Background triggers that wake the wrong workspace.
- Decision records retrieved without tenant filters.
- Artifacts stored under guessable global paths.
- Secrets passed through browser-visible API responses.
- Workflow runners accepting tenant scope from model-generated payloads.

## Acceptance Bar

Before hosted multi-user runtime work is considered ready, two users in two workspaces must be able to run separate agents with separate memories, ledgers, tools, schedules, artifacts, and secrets.
