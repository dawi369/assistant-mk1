# Fly.io Dev/Staging Deployment

Fly is the hosted dev/staging execution runtime. Local development remains the
primary coding loop. Vercel owns the hosted frontend; Fly owns LangGraph and
signed executor work.

## Shape

Active runtime app:

- App: `assistant-mk1-langgraph-dev`
- Public gateway: `https://assistant-mk1-langgraph-dev.fly.dev`
- Gateway on `PORT`, default `3000`
- LangGraph dev server on `LANGGRAPH_PORT`, default `2024`
- Gateway proxies LangGraph traffic to `LANGGRAPH_UPSTREAM_URL`
- Gateway serves signed workbench executor requests

This split removes the Vercel -> Fly Next proxy -> LangGraph hop.
Hosted chat traffic now reaches this gateway through the Cloudflare
`/langgraph` facade.

## Required Secrets

Set secrets with `fly secrets set`; do not commit them.

For the dedicated LangGraph runtime, set:

```bash
fly secrets set OPENROUTER_API_KEY=...
fly secrets set WORKBENCH_EXECUTOR_TOKEN=...
fly secrets set LANGGRAPH_PROXY_TOKEN=...
```

Optional:

```bash
fly secrets set LANGSMITH_API_KEY=...
fly secrets set LANGSMITH_TRACING=true
fly secrets set LANGSMITH_PROJECT=assistant-mk1-langgraph-dev
```

## First Deploy

```bash
fly apps create assistant-mk1-langgraph-dev --region fra
pnpm deploy:fly:langgraph
```

If the app name is taken, change `app` and `OPENROUTER_SITE_URL` in
`fly.langgraph.toml`.

## Smoke Checks

Health:

```bash
curl https://assistant-mk1-langgraph-dev.fly.dev/health
```

LangGraph gateway:

```bash
LANGGRAPH_RUNTIME_BASE_URL=https://assistant-mk1-langgraph-dev.fly.dev \
LANGGRAPH_PROXY_TOKEN=<token> \
pnpm smoke:langgraph-runtime
```

Cloudflare facade to this gateway:

```bash
CLOUDFLARE_CONTROL_PLANE_URL=<remote-worker-url> \
CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN=<token> \
pnpm smoke:cloudflare-langgraph-facade
```

Cloudflare chat thread boundary:

```bash
CLOUDFLARE_CONTROL_PLANE_URL=<remote-worker-url> \
CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN=<token> \
pnpm smoke:cloudflare-chat-boundary
```

Cloudflare session boundary:

```bash
CLOUDFLARE_CONTROL_PLANE_URL=<remote-worker-url> \
CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN=<token> \
pnpm smoke:cloudflare-session-boundary
```

Workbench vertical slice through the remote Worker:

```bash
CLOUDFLARE_CONTROL_PLANE_URL=<remote-worker-url> \
CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN=<token> \
pnpm smoke:cloudflare-workbench-run
```

This verifies the production-shaped dev path:

```text
remote Cloudflare Worker -> remote D1
                         -> signed Fly runtime executor
                         -> Worker callbacks -> remote D1 snapshot
```

Hosted Vercel workbench routes require a signed-in WorkOS browser session.
`pnpm smoke:workbench` remains a local same-origin smoke, not the hosted deploy
runtime smoke.

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
pnpm db:cloudflare:rebuild:remote
pnpm deploy:cloudflare
CLOUDFLARE_CONTROL_PLANE_URL=<remote-worker-url> \
CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN=<token> \
pnpm smoke:cloudflare-session-boundary
CLOUDFLARE_CONTROL_PLANE_URL=<remote-worker-url> \
CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN=<token> \
pnpm smoke:cloudflare-chat-boundary
CLOUDFLARE_CONTROL_PLANE_URL=<remote-worker-url> \
CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN=<token> \
pnpm smoke:cloudflare-workbench-run
```

Only run `d1 create` if the database is missing, and copy its returned
`database_id` into `cloudflare/control-plane/wrangler.jsonc` before rebuilding
the current schema. The rebuild command drops remote dev D1 tables by design.

Frontend:

- Open the Vercel URL.
- Run "Run demo inspect" and confirm the Dev Monitor shows completed run,
  tool call, artifact, decision, and audit timeline.
- Send a message.
- Confirm a thread is created and streaming works.
- Confirm server logs do not expose provider secrets.

## Health Checks

`fly.langgraph.toml` checks `/health`. That endpoint confirms the runtime
gateway is up and reports its configured LangGraph upstream URL. It does not
call the model provider.

## Persistence Warning

This first Fly setup does not mount volumes. Do not rely on local filesystem state for important work. Before production use, verify LangGraph persistence behavior across Machine restarts and choose durable persistence intentionally.
