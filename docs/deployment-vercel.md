# Vercel Frontend Deployment

Vercel is the hosted frontend target for the Next.js workbench shell.

## Current Shape

The current deployed flow is:

```text
Browser -> Vercel Next.js frontend
        -> Cloudflare Worker/D1 for workbench run control
        -> Fly executor for demo.inspect callbacks

Browser -> Vercel Next.js /api proxy
        -> Fly Next /api proxy
        -> Fly LangGraph server
```

The second path is transitional. The target split is Vercel Next.js talking to a
dedicated Fly LangGraph service, not another Next proxy.

## Required Environment

Set these in Vercel Production before deploying:

```bash
NEXT_PUBLIC_LANGGRAPH_ASSISTANT_ID=agent
LANGGRAPH_API_URL=https://assistant-mk1-dev.fly.dev/api
CLOUDFLARE_CONTROL_PLANE_URL=https://assistant-mk1-dev-control-plane.david-erwin-cz68.workers.dev
CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN=<secret>
WORKBENCH_DEV_USER_ID=dev-user
WORKBENCH_DEV_WORKSPACE_ID=dev-workspace
WORKBENCH_DEV_AGENT_ID=dev-agent
```

`LANGGRAPH_API_URL` points at the Fly Next proxy only until LangGraph is split
into its own Fly service.

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

## Next Split

Before treating this as the durable production topology, split Fly into a
LangGraph/tool-runner service that Vercel and Cloudflare can call through a
signed server-to-server boundary. Vercel should own frontend rendering and
browser-facing API proxying only; Cloudflare should own run control and tenant
state; Fly should own heavy execution.
