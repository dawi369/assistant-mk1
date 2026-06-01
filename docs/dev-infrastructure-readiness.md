# Dev Infrastructure Readiness

This checklist prepares Assistant-MK1 dev infrastructure without provisioning
Cloudflare resources before the data-client backing implementation is scoped.

## Current Remote Baseline

- Fly app: `assistant-mk1-dev`
- Region: `fra`
- URL: `https://assistant-mk1-dev.fly.dev`
- Runtime shape: one Fly Machine runs Next.js and the LangGraph dev server.
- Required smoke: `SMOKE_BASE_URL=https://assistant-mk1-dev.fly.dev pnpm smoke:workbench`

## Fly Configuration

Required secrets:

- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL`
- `EXTERNAL_SIGNAL_TOKEN`

Optional secrets:

- `LANGSMITH_API_KEY`
- `LANGSMITH_TRACING`
- `LANGSMITH_PROJECT`
- `LANGCHAIN_API_KEY`

Committed Fly env:

- `LANGGRAPH_API_URL=http://127.0.0.1:2024`
- `NEXT_PUBLIC_LANGGRAPH_ASSISTANT_ID=agent`
- `OPENROUTER_APP_NAME=assistant-mk1-dev`
- `OPENROUTER_SITE_URL=https://assistant-mk1-dev.fly.dev`

## Local Durable Store

The local data-client backing writes JSON state to
`.assistant-mk1/local-store.json` by default. Override it with
`WORKBENCH_STORE_PATH` when running isolated local smokes. This store is dev
infrastructure only; Cloudflare D1/R2/Durable Object resources remain
unprovisioned until the data-client access patterns are proven.

## Local Cloudflare Control-Plane Probe

The first Cloudflare-in-the-loop slice is local only. It adds a Wrangler Worker
with a local D1 binding named `DB` and a scoped run-probe table. It proves the
mediated path from the Next/Fly workbench runtime to a Cloudflare API without
creating remote Cloudflare resources.

Local commands:

```bash
cat > cloudflare/control-plane/.dev.vars <<'EOF'
CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN=local-dev-token
WORKBENCH_EXECUTOR_URL=http://localhost:3000/api/workbench/executors/demo-inspect
WORKBENCH_EXECUTOR_TOKEN=local-executor-token
EOF
pnpm db:cloudflare:migrate:local
pnpm dev:cloudflare
pnpm smoke:cloudflare:local
```

To include the Worker in the workbench demo, run the Next app with:

```bash
CLOUDFLARE_CONTROL_PLANE_URL=http://localhost:8787 \
CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN=local-dev-token \
WORKBENCH_EXECUTOR_TOKEN=local-executor-token \
pnpm dev
```

`POST /api/workbench/demo-runs` remains the demo ingress. When the control-plane
env vars are set, the demo runtime reports queued, running, and terminal run
status to the local Worker and records a safe probe summary in audit events.
When the env vars are absent, the existing JSON-backed demo path is unchanged.

This local path is transitional. It proves that the workbench runtime can write
status through a mediated Cloudflare API, but it does not mean Next.js remains
the long-term control plane. In the production target, the browser starts with
Cloudflare, Cloudflare derives tenant scope and owns run coordination, and
Fly/LangGraph report heavy-work progress back through Cloudflare.

The next thin production-shaped path is the Cloudflare-owned demo run:

```bash
pnpm smoke:cloudflare-owned-run:local
```

That smoke starts at the Next proxy, creates the run in the local Cloudflare
Worker, delegates execution to the signed Next executor, receives callbacks,
and reads the completed run snapshot from D1-owned Cloudflare state.

## Local Tool Adapter Foundation

The first tool adapter slice uses an in-process runtime registry and exposure
resolver. `demo.inspect` is exposed only for dry-run observe workflows. This is
the server-side seam that future Cloudflare/Fly tool execution should preserve;
it is not a durable tool registry or permission store yet.

## Future Cloudflare Resources

Do not create these until the local Cloudflare-mediated data-client path has
passed smoke checks and the first remote-backed repository group is scoped.

Planned dev resource names:

- D1 database: `assistant_mk1_dev`
- R2 bucket: `assistant-mk1-dev-artifacts`
- Durable Object namespace: `ASSISTANT_MK1_DEV_AGENTS`
- Worker or Agent service: `assistant-mk1-dev-control-plane`

Planned bindings:

- `DB` for D1 relational records.
- `ARTIFACTS` for R2 artifact blobs.
- `AGENTS` for per-agent hot coordination state.

## Provisioning Gates

Before creating Cloudflare resources, define:

- Which `AgentFrameworkDataClient` repository group is implemented first.
- The tenant-scope derivation path for local/dev requests.
- The minimum D1 tables or Durable Object storage required for that repository
  group.
- The R2 object key convention for artifact metadata produced by the demo slice.
- A smoke command that proves two fixture tenants cannot read each other's state.

## Out Of Scope For This Step

- Production auth provider.
- Secret custody implementation.
- Remote D1/R2 migrations.
- Direct D1/R2 access from Fly or LangGraph workers.
- Mutation-capable tools.
- Cloudflare Worker, Agent, D1, R2, or Durable Object deployment.
