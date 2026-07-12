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

This split removes the old Vercel -> Fly Next proxy -> LangGraph hop. Normal
hosted chat now runs through Cloudflare Agents. The Fly gateway remains for
LangGraph compatibility paths, explicit workflow escalation, and signed tool
runner work.

## Required Secrets

Set secrets with `fly secrets set`; do not commit them.

For the dedicated LangGraph runtime, set:

```bash
fly secrets set OPENROUTER_API_KEY=...
fly secrets set WORKBENCH_EXECUTOR_TOKEN=...
fly secrets set WORKBENCH_RUNNER_SIGNING_SECRET=...
fly secrets set WORKBENCH_CALLBACK_SIGNING_SECRET=...
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

Tool runner transport:

```bash
LANGGRAPH_RUNTIME_BASE_URL=https://assistant-mk1-langgraph-dev.fly.dev \
WORKBENCH_RUNNER_SIGNING_SECRET=<runner-secret> \
pnpm smoke:fly-tool-runner
```

When validating callback-backed runner behavior against a reachable callback
receiver, also set `WORKBENCH_RUNNER_CALLBACK_URL`.

Cloudflare uses this path only when the Worker is configured with
`WORKBENCH_RUNNER_TRANSPORT=fly`, `WORKBENCH_RUNNER_URL`, and the matching
`WORKBENCH_RUNNER_SIGNING_SECRET`. Without those settings, `url.inspect`
continues to use the Cloudflare-inline runner.

Fly machine health uses `GET /health/live`, a shallow gateway liveness check
that does not call LangGraph. Use `GET /health` for deep manual or smoke checks
that should prove the gateway can reach the LangGraph `/ok` endpoint. A healthy
steady-state Fly log should show startup plus Fly health state changes, not
recurring LangGraph `/ok` lines every 15 seconds from machine checks.

The Fly runtime currently pins `@langchain/langgraph-cli@1.2.3` intentionally.
Patch `1.2.5` pulls a LangGraph API build that imports an export missing from
the current `@langchain/langgraph@1.3.2`, which prevents the Fly LangGraph side
from booting.

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
pnpm db:cloudflare:migrate:remote
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
- Open Admin with `/admin`, run "Run demo inspect", and confirm it shows completed run,
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
