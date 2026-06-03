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
- Required smoke: `SMOKE_TIMEOUT_MS=30000 SMOKE_BASE_URL=https://assistant-mk1.vercel.app pnpm smoke:workbench`
- Cloudflare Worker: `assistant-mk1-dev-control-plane`
- Cloudflare D1 database: `assistant_mk1_dev`
- D1 binding: `DB`
- Workbench smoke alias: `pnpm smoke:workbench` runs the Cloudflare-owned run
  smoke.

The Vercel frontend uses the same Cloudflare-owned workbench routes. Its
LangGraph proxy points at `https://assistant-mk1-langgraph-dev.fly.dev`, which
authenticates server-to-server proxy traffic with `LANGGRAPH_PROXY_TOKEN`.

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
pnpm db:cloudflare:migrate:local
pnpm dev:cloudflare
```

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
pnpm smoke:workbench:local
```

That smoke starts at the Next proxy, creates the run in the local Cloudflare
Worker, delegates execution to the signed Next executor, receives callbacks,
and reads the completed run snapshot from D1-owned Cloudflare state.

To prove D1 tenant isolation at the Worker boundary, run:

```bash
pnpm smoke:tenant-isolation
```

That smoke uses two trusted dev tenant identities and verifies each tenant sees
only its own latest run.

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
pnpm db:cloudflare:migrate:remote
pnpm deploy:cloudflare
```

Only run `d1 create` when `assistant_mk1_dev` is missing. After creation, copy
the returned `database_id` into `cloudflare/control-plane/wrangler.jsonc`.

Remote Worker secrets and vars:

```bash
pnpm wrangler secret put CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN --config cloudflare/control-plane/wrangler.jsonc
pnpm wrangler secret put WORKBENCH_EXECUTOR_TOKEN --config cloudflare/control-plane/wrangler.jsonc
pnpm wrangler secret put WORKBENCH_EXECUTOR_URL --config cloudflare/control-plane/wrangler.jsonc
```

Use
`https://assistant-mk1-langgraph-dev.fly.dev/workbench/executors/demo-inspect`
as the remote executor URL. Do not commit token values.

Remote Worker smoke:

```bash
SMOKE_TIMEOUT_MS=30000 SMOKE_BASE_URL=https://assistant-mk1.vercel.app pnpm smoke:workbench
```

`pnpm smoke:workbench` is intentionally the same Cloudflare-owned run smoke as
`pnpm smoke:cloudflare-owned-run`.

The browser-visible `Run demo inspect` button uses the Cloudflare-owned route by
default. Missing Cloudflare configuration should fail visibly; there is no
secondary local demo route.

Tenant scope for the current dev baseline is temporary and server-derived.
Vercel/Next reads `WORKBENCH_DEV_USER_ID`, `WORKBENCH_DEV_WORKSPACE_ID`, and
`WORKBENCH_DEV_AGENT_ID`, then forwards those values to the Worker as trusted
headers. Browser requests never choose tenant scope.

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
- The production auth/session source that replaces the temporary dev tenant
  env vars.
- The minimum D1 tables or Durable Object storage required for that repository
  group.
- The R2 object key convention for artifact metadata produced by the demo slice.
- A smoke command that proves two dev tenants cannot read each other's state.

## Out Of Scope For This Step

- Production auth provider.
- Secret custody implementation.
- R2 migrations or bucket provisioning.
- Durable Object provisioning.
- Direct D1/R2 access from Fly or LangGraph workers.
- Mutation-capable tools.
- Cloudflare Agent, R2, or Durable Object deployment.
