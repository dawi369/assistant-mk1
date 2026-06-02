# Fly.io Dev/Staging Deployment

Fly is the hosted dev/staging runtime. Local development remains the primary coding loop.

## Shape

The first Fly deployment runs both processes in one Machine:

- Next.js on `PORT`, default `3000`.
- LangGraph dev server on `LANGGRAPH_PORT`, default `2024`.
- Next proxies to LangGraph through `LANGGRAPH_API_URL=http://127.0.0.1:2024`.

This is intentionally simple for staging. Revisit service separation before treating it as production infrastructure.

## Required Secrets

Set secrets with `fly secrets set`; do not commit them.

```bash
fly secrets set OPENROUTER_API_KEY=...
fly secrets set EXTERNAL_SIGNAL_TOKEN=...
```

For the remote Cloudflare-owned run baseline, also set:

```bash
fly secrets set CLOUDFLARE_CONTROL_PLANE_URL=<remote-worker-url>
fly secrets set CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN=...
fly secrets set WORKBENCH_EXECUTOR_TOKEN=...
fly secrets set WORKBENCH_DEV_USER_ID=dev-user
fly secrets set WORKBENCH_DEV_WORKSPACE_ID=dev-workspace
fly secrets set WORKBENCH_DEV_AGENT_ID=dev-agent
```

Optional:

```bash
fly secrets set LANGSMITH_API_KEY=...
fly secrets set LANGSMITH_TRACING=true
fly secrets set LANGSMITH_PROJECT=assistant-mk1-dev
fly secrets set LANGCHAIN_API_KEY=...
```

## First Deploy

```bash
fly apps create assistant-mk1-dev --region fra
fly deploy
```

If the app name is taken, change `app` and `OPENROUTER_SITE_URL` in `fly.toml`.

## Smoke Checks

Health:

```bash
curl https://assistant-mk1-dev.fly.dev/api/health
```

Workbench vertical slice:

```bash
SMOKE_BASE_URL=https://assistant-mk1-dev.fly.dev pnpm smoke:workbench
```

This verifies the production-shaped dev path:

```text
Fly/Next proxy -> remote Cloudflare Worker -> remote D1
              -> signed Fly/Next executor
              -> Worker callbacks -> remote D1 snapshot
```

The Fly app must have `CLOUDFLARE_CONTROL_PLANE_URL`,
`CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN`, `WORKBENCH_EXECUTOR_TOKEN`, and the three
`WORKBENCH_DEV_*` identity values set before this smoke can pass.
`pnpm smoke:workbench` is an alias for the Cloudflare-owned run smoke.

To prove scoped remote D1 reads and writes, run:

```bash
CLOUDFLARE_CONTROL_PLANE_URL=<remote-worker-url> \
CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN=<token> \
pnpm smoke:tenant-isolation
```

That smoke calls the Worker with two trusted dev tenant identities and confirms
cross-tenant run reads return `404`.

Cloudflare remote deploy sequence:

```bash
pnpm wrangler d1 list
pnpm wrangler d1 create assistant_mk1_dev --config cloudflare/control-plane/wrangler.jsonc
pnpm db:cloudflare:migrate:remote
pnpm deploy:cloudflare
SMOKE_BASE_URL=https://assistant-mk1-dev.fly.dev pnpm smoke:workbench
```

Only run `d1 create` if the database is missing, and copy its returned
`database_id` into `cloudflare/control-plane/wrangler.jsonc` before remote
migration.

External signal:

```bash
curl -X POST https://assistant-mk1-dev.fly.dev/api/external-signals \
  -H "Authorization: Bearer $EXTERNAL_SIGNAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"start","input":{"messages":[{"role":"user","content":"Say deployed smoke test ok."}]}}'
```

Frontend:

- Open the Fly URL.
- Run "Run demo inspect" and confirm the workbench panel shows completed run,
  tool call, artifact, decision, and audit timeline.
- Send a message.
- Confirm a thread is created and streaming works.
- Confirm server logs do not expose provider secrets.

## Health Checks

`fly.toml` checks `/api/health`. That endpoint confirms the Next server is up and reports the configured LangGraph API URL and assistant id. It does not call the model provider.

## Persistence Warning

This first Fly setup does not mount volumes. Do not rely on local filesystem state for important work. Before production use, verify LangGraph persistence behavior across Machine restarts and choose durable persistence intentionally.
