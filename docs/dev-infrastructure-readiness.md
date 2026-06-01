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

## Future Cloudflare Resources

Do not create these until the first Cloudflare-backed data-client slice is
scoped.

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
- D1/R2 migrations.
- Direct D1/R2 access from Fly or LangGraph workers.
- Mutation-capable tools.
- Cloudflare Worker, Agent, or Wrangler deployment.
