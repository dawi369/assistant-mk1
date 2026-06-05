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

## Identity, Workspace, And Agent Model

Assistant-MK1 is meant to serve many customer environments and many internal
use cases without confusing product organization with tenant identity.

- WorkOS User: the authenticated person. WorkOS owns sign-in, sessions, and
  enterprise identity features such as SSO or directory sync when they are
  added.
- WorkOS Organization: the customer or company tenant in a B2B deployment.
  This should normally map 1:1 to an Assistant-MK1 workspace. It is not the
  right abstraction for every project or every agent.
- Assistant-MK1 Workspace: the internal tenant boundary used by Cloudflare and
  D1. Membership, policy, secrets, tool permissions, agents, audit records, and
  durable state are scoped here.
- Agent: a runtime assistant/configuration inside a workspace. A workspace can
  have multiple agents with different tools, policies, knowledge, and operating
  modes.

For a business customer, the north-star mapping is:

```txt
WorkOS organization -> Assistant-MK1 workspace -> agents
```

For current solo/pre-user development, a signed-in WorkOS user without an
organization gets a stable personal workspace id:

```txt
workos-personal:<workos-user-id>
```

That fallback keeps the production-shaped Cloudflare authz path working during
development and can support a future solo tier. It is not the B2B tenant model.

There is no committed Project entity in the current architecture. Workspace and
agent are the committed authorization boundaries.

## Hard Rules

- The model never chooses tenant scope.
- Scope is derived from authenticated request/session context or trusted system trigger metadata.
- Queries must include tenant scope at the storage/access layer, not only in prompts.
- Tool execution receives scope from the runtime and cannot override it.
- Secret lookup requires tenant scope plus tool permission.
- Cross-workspace sharing is denied by default and must be designed as an explicit future capability.
- Browser code never chooses `userId`, `workspaceId`, or `agentId`; it can only
  ask the server for the current resolved context.
- WorkOS owns authentication and organization membership signals. Cloudflare
  owns application authorization, internal workspace materialization, agent
  records, tool access, secret policy, run control, and audit.

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
