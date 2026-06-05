# Dev Infrastructure Readiness

This checklist tracks the tiny dev infrastructure baseline for Assistant-MK1.
The current remote Cloudflare scope is intentionally narrow: one Worker, one D1
database, the Vercel frontend, and the dedicated Fly LangGraph runtime gateway.

## Current Remote Baseline

- Fly runtime app: `assistant-mk1-langgraph-dev`
- Region: `fra`
- Runtime URL: `https://assistant-mk1-langgraph-dev.fly.dev`
- Runtime shape: one Fly Machine runs the gateway and LangGraph dev server.
- Vercel frontend: `https://assistant-mk1.vercel.app`
- Hosted auth: WorkOS AuthKit on Vercel; WorkOS `user.id` maps to internal
  `userId`, WorkOS `organizationId` maps to internal `workspaceId`.
- Required smoke: `SMOKE_TIMEOUT_MS=30000 SMOKE_BASE_URL=https://assistant-mk1.vercel.app pnpm smoke:workbench`
- Cloudflare Worker: `assistant-mk1-dev-control-plane`
- Cloudflare D1 database: `assistant_mk1_dev`
- D1 binding: `DB`
- Workbench smoke alias: `pnpm smoke:workbench` runs the Cloudflare-owned run
  smoke.

The Vercel frontend uses the same Cloudflare-owned workbench routes. Its
LangGraph proxy points at the Cloudflare `/langgraph` facade, which
authenticates Vercel with the dev control-plane token and then authenticates to
the Fly gateway with `LANGGRAPH_UPSTREAM_TOKEN`.

Hosted Vercel requests derive tenant scope from the WorkOS server session.
Users must complete WorkOS sign-in and have an active organization before the
workbench can call Cloudflare. `WORKBENCH_DEV_AGENT_ID` remains the temporary
hosted dev agent selection; it is not a tenant selector.

The `/langgraph` facade also stores tenant-scoped chat sessions, chat thread
ownership, chat intents, policy decisions, and minimal chat run envelopes in
D1. It also appends tenant-scoped control-plane events for session, thread,
intent, policy, and run progress. Those events are available through snapshot
routes and a short-lived SSE stream. This proves the dev multi-tenant,
execution-policy, and observable-progress boundary without adding frontend
auth, Durable Objects, queues, or transcript storage.

## Fly Configuration

Required secrets:

- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL`
- `WORKBENCH_EXECUTOR_TOKEN`
- `LANGGRAPH_PROXY_TOKEN`

Optional secrets:

- `LANGSMITH_API_KEY`
- `LANGSMITH_TRACING`
- `LANGSMITH_PROJECT`
- `LANGCHAIN_API_KEY`

Committed Fly env:

- `LANGGRAPH_PORT=2024`
- `LANGGRAPH_UPSTREAM_URL=http://127.0.0.1:2024`
- `OPENROUTER_APP_NAME=assistant-mk1-langgraph-dev`
- `OPENROUTER_SITE_URL=https://assistant-mk1-langgraph-dev.fly.dev`

## Local Cloudflare Control Plane

The local Cloudflare loop uses Wrangler with a local D1 binding named `DB` and
the same Worker run-control routes as remote dev. It remains the cheapest inner
loop for Worker changes.

Local commands:

```bash
cat > cloudflare/control-plane/.dev.vars <<'EOF'
CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN=local-dev-token
WORKBENCH_EXECUTOR_URL=http://localhost:3000/api/workbench/executors/demo-inspect
WORKBENCH_EXECUTOR_TOKEN=local-executor-token
EOF
pnpm db:cloudflare:rebuild:local
pnpm dev:cloudflare
```

The rebuild command is destructive for local dev D1 state.

In another terminal, run the Next app with:

```bash
CLOUDFLARE_CONTROL_PLANE_URL=http://localhost:8787 \
CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN=local-dev-token \
WORKBENCH_EXECUTOR_TOKEN=local-executor-token \
WORKBENCH_DEV_USER_ID=dev-user \
WORKBENCH_DEV_WORKSPACE_ID=dev-workspace \
WORKBENCH_DEV_AGENT_ID=dev-agent \
pnpm dev
```

Then smoke the same Cloudflare-owned path locally:

```bash
SMOKE_BASE_URL=http://localhost:3000 pnpm smoke:workbench
```

That smoke starts at the Next proxy, creates the run in the local Cloudflare
Worker, delegates execution to the signed Next executor, receives callbacks,
and reads the completed run snapshot from D1-owned Cloudflare state.

To prove D1 tenant isolation at the Worker boundary, run:

```bash
pnpm smoke:tenant-isolation
pnpm smoke:cloudflare-session-boundary
pnpm smoke:cloudflare-chat-boundary
pnpm smoke:cloudflare-policy-boundary
pnpm smoke:cloudflare-event-feed
pnpm smoke:cloudflare-event-stream
```

Those smokes use two trusted dev tenant identities. They verify each tenant sees
only its own workbench runs, chat sessions, and LangGraph chat threads. The
policy smoke also verifies that normal `ask` chat passes, `execute` chat is
blocked, and duplicate same-thread execution is rejected while a run is already
`running`. The event-feed smoke verifies tenant-scoped progress events and the
`after` cursor route. The event-stream smoke verifies the same progress can be
observed over the Worker SSE stream.

The local Worker code is split by responsibility: route dispatch, HTTP/auth
helpers, Cloudflare-owned demo-run handlers, and D1-backed demo run storage.

## Remote Cloudflare Control Plane

The remote dev baseline proves this production-shaped path:

```text
Vercel Next proxy -> remote Cloudflare Worker -> remote D1
                  -> signed Fly runtime executor
                  -> Worker callbacks -> remote D1 snapshot
```

Provisioning and deploy commands:

```bash
pnpm wrangler d1 list
pnpm wrangler d1 create assistant_mk1_dev --config cloudflare/control-plane/wrangler.jsonc
pnpm db:cloudflare:rebuild:remote
pnpm deploy:cloudflare
```

The rebuild command is destructive for remote dev D1 state. That is intentional
while this schema is still early-dev and disposable.

Only run `d1 create` when `assistant_mk1_dev` is missing. After creation, copy
the returned `database_id` into `cloudflare/control-plane/wrangler.jsonc`.

Remote Worker secrets and vars:

```bash
pnpm wrangler secret put CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN --config cloudflare/control-plane/wrangler.jsonc
pnpm wrangler secret put LANGGRAPH_UPSTREAM_TOKEN --config cloudflare/control-plane/wrangler.jsonc
pnpm wrangler secret put WORKBENCH_EXECUTOR_TOKEN --config cloudflare/control-plane/wrangler.jsonc
pnpm wrangler secret put WORKBENCH_EXECUTOR_URL --config cloudflare/control-plane/wrangler.jsonc
```

Use
`https://assistant-mk1-langgraph-dev.fly.dev/workbench/executors/demo-inspect`
as the remote executor URL. Do not commit token values.

`LANGGRAPH_UPSTREAM_URL` is committed in `wrangler.jsonc` and points at
`https://assistant-mk1-langgraph-dev.fly.dev`. `LANGGRAPH_UPSTREAM_TOKEN` must
match the Fly `LANGGRAPH_PROXY_TOKEN`.

Cloudflare LangGraph facade smoke:

```bash
CLOUDFLARE_CONTROL_PLANE_URL=<remote-worker-url> \
CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN=<token> \
pnpm smoke:cloudflare-langgraph-facade
```

Cloudflare chat boundary smoke:

```bash
CLOUDFLARE_CONTROL_PLANE_URL=<remote-worker-url> \
CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN=<token> \
pnpm smoke:cloudflare-chat-boundary
```

Cloudflare session boundary smoke:

```bash
CLOUDFLARE_CONTROL_PLANE_URL=<remote-worker-url> \
CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN=<token> \
pnpm smoke:cloudflare-session-boundary
```

Cloudflare policy boundary smoke:

```bash
CLOUDFLARE_CONTROL_PLANE_URL=<remote-worker-url> \
CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN=<token> \
pnpm smoke:cloudflare-policy-boundary
```

Cloudflare event feed smoke:

```bash
CLOUDFLARE_CONTROL_PLANE_URL=<remote-worker-url> \
CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN=<token> \
pnpm smoke:cloudflare-event-feed
```

Cloudflare event stream smoke:

```bash
CLOUDFLARE_CONTROL_PLANE_URL=<remote-worker-url> \
CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN=<token> \
pnpm smoke:cloudflare-event-stream
```

Remote Worker smoke:

```bash
SMOKE_TIMEOUT_MS=30000 SMOKE_BASE_URL=https://assistant-mk1.vercel.app pnpm smoke:workbench
```

`pnpm smoke:workbench` is the Cloudflare-owned run smoke.

The browser-visible `Run demo inspect` button uses the Cloudflare-owned route by
default. Missing Cloudflare configuration should fail visibly; there is no
secondary local demo route.

Tenant scope for the hosted Vercel baseline is server-derived from WorkOS
AuthKit. Vercel/Next maps WorkOS `user.id` to internal `userId`, WorkOS
`organizationId` to internal `workspaceId`, and `WORKBENCH_DEV_AGENT_ID` to the
current hosted dev agent id, then forwards those values to the Worker as
trusted headers. Browser requests never choose tenant scope. The WorkOS client
id and API key must come from the same WorkOS app/environment, and the Vercel
Production redirect URI must be
`https://assistant-mk1.vercel.app/auth/callback`.

Local development can still fall back to `WORKBENCH_DEV_USER_ID` and
`WORKBENCH_DEV_WORKSPACE_ID` when WorkOS is not configured. That fallback is
for local smoke convenience only; hosted Vercel should use WorkOS session
identity.

## Local Tool Adapter Foundation

The first tool adapter slice uses an in-process runtime registry and exposure
resolver. `demo.inspect` is exposed only for dry-run observe workflows. This is
the server-side seam that future Cloudflare/Fly tool execution should preserve;
it is not a durable tool registry or permission store yet.

## Future Cloudflare Resources

The Worker and D1 resources above are now the remote dev baseline. Do not create
R2, Durable Object, Access, or production auth resources until the first
remote-backed repository group is explicitly scoped.

Planned dev resource names:

- R2 bucket: `assistant-mk1-dev-artifacts`
- Durable Object namespace: `ASSISTANT_MK1_DEV_AGENTS`

Planned bindings:

- `ARTIFACTS` for R2 artifact blobs.
- `AGENTS` for per-agent hot coordination state.

## Provisioning Gates

Before creating additional Cloudflare resources, define:

- Which `AgentFrameworkDataClient` repository group is implemented first.
- The production authorization policy that expands WorkOS sign-in into
  workspace membership, roles, and agent selection.
- The minimum D1 tables or Durable Object storage required for that repository
  group.
- The R2 object key convention for artifact metadata produced by the demo slice.
- A smoke command that proves two dev tenants cannot read each other's state.

## Out Of Scope For This Step

- Production authorization policy beyond WorkOS sign-in.
- Secret custody implementation.
- R2 schema/resource provisioning.
- Durable Object provisioning.
- Direct D1/R2 access from Fly or LangGraph workers.
- Mutation-capable tools.
- Cloudflare Agent, R2, or Durable Object deployment.
