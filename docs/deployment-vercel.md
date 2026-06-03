# Vercel Frontend Deployment

Vercel is the hosted frontend target for the Next.js workbench shell.

## Current Shape

The current deployed flow is:

```text
Browser -> Vercel Next.js frontend
        -> Cloudflare Worker/D1 for workbench run control
        -> Fly LangGraph runtime executor for demo.inspect callbacks

Browser -> Vercel Next.js /api proxy
        -> Fly LangGraph runtime gateway
        -> Fly LangGraph server
```

Vercel owns frontend rendering and browser-facing API proxying. Cloudflare owns
run control and tenant state. Fly owns LangGraph and signed executor work.

## Required Environment

Set these in Vercel Production before deploying:

```bash
NEXT_PUBLIC_LANGGRAPH_ASSISTANT_ID=agent
LANGGRAPH_API_URL=https://assistant-mk1-langgraph-dev.fly.dev
LANGCHAIN_API_KEY=<shared-gateway-token>
CLOUDFLARE_CONTROL_PLANE_URL=https://assistant-mk1-dev-control-plane.david-erwin-cz68.workers.dev
CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN=<secret>
WORKBENCH_DEV_USER_ID=dev-user
WORKBENCH_DEV_WORKSPACE_ID=dev-workspace
WORKBENCH_DEV_AGENT_ID=dev-agent
```

`LANGCHAIN_API_KEY` is sent by the Vercel `/api` proxy as `x-api-key` and must
match `LANGGRAPH_PROXY_TOKEN` on the Fly runtime gateway.

## Deploy

The repo lockfile is generated with pnpm 10. Keep `packageManager` pinned to
`pnpm@10.33.0`; pnpm 11 can fail Vercel install because ignored dependency
build scripts become install errors.

```bash
vercel --prod --yes
```

Current production alias:

```text
https://assistant-mk1.vercel.app
```

## Smoke Checks

```bash
curl https://assistant-mk1.vercel.app/api/health
SMOKE_TIMEOUT_MS=30000 SMOKE_BASE_URL=https://assistant-mk1.vercel.app pnpm smoke:workbench
curl -X POST https://assistant-mk1.vercel.app/api/threads \
  -H "Content-Type: application/json" \
  -d '{}'
```

The workbench smoke may need the longer timeout when Fly is cold-starting.

## Runtime Dependency

Deploy `assistant-mk1-langgraph-dev` before deploying Vercel changes that point
`LANGGRAPH_API_URL` at it. See `docs/deployment-fly.md`.
