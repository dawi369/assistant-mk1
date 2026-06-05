# Vercel Frontend Deployment

Vercel is the hosted frontend target for the Next.js workbench shell.

## Current Shape

The current deployed flow is:

```text
Browser -> Vercel Next.js frontend
        -> Cloudflare Worker/D1 for workbench run control
        -> Fly LangGraph runtime executor for demo.inspect callbacks

Browser -> Vercel Next.js /api proxy
        -> Cloudflare /langgraph facade
        -> Fly LangGraph runtime gateway
        -> Fly LangGraph server
```

Vercel owns frontend rendering and browser-facing API proxying. Cloudflare owns
run control, tenant state, chat sessions, chat thread ownership, chat intents,
chat policy decisions, and the control-plane activity feed plus event stream.
Fly owns LangGraph and signed executor work.

WorkOS AuthKit is the current hosted identity boundary. A signed-in WorkOS user
with an active `organizationId` is required before hosted Vercel routes can
call the Cloudflare control plane. Vercel maps WorkOS identity into trusted
headers; the browser never sends tenant scope directly.

## Required Environment

Set these in Vercel Production before deploying:

```bash
NEXT_PUBLIC_LANGGRAPH_ASSISTANT_ID=agent
LANGGRAPH_API_URL=https://assistant-mk1-dev-control-plane.david-erwin-cz68.workers.dev/langgraph
LANGCHAIN_API_KEY=
CLOUDFLARE_CONTROL_PLANE_URL=https://assistant-mk1-dev-control-plane.david-erwin-cz68.workers.dev
CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN=<secret>
WORKOS_CLIENT_ID=<secret>
WORKOS_API_KEY=<secret>
WORKOS_COOKIE_PASSWORD=<secret>
NEXT_PUBLIC_WORKOS_REDIRECT_URI=https://assistant-mk1.vercel.app/auth/callback
WORKBENCH_DEV_AGENT_ID=dev-agent
```

`WORKOS_CLIENT_ID` and `WORKOS_API_KEY` must belong to the same WorkOS
environment/application. A mismatched key pair causes `/auth/callback` to fail
with WorkOS `invalid_client` / `Invalid client secret` after the upstream
identity provider sign-in succeeds.

Do not mirror local `.env.local` into Vercel Production blindly:

- Local redirect URI: `http://localhost:3000/auth/callback`
- Production redirect URI: `https://assistant-mk1.vercel.app/auth/callback`

The Vercel `/api` proxy authenticates to Cloudflare with
`CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN` and trusted identity headers derived from
the WorkOS AuthKit server session. WorkOS `user.id` becomes the internal
`userId`, WorkOS `organizationId` becomes the internal `workspaceId`, and
`WORKBENCH_DEV_AGENT_ID` remains the temporary hosted dev agent selection.
Cloudflare stores the Fly gateway token as `LANGGRAPH_UPSTREAM_TOKEN`. Browser
requests never provide tenant ids directly.

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
node -e "fetch('https://assistant-mk1.vercel.app/sign-in',{redirect:'manual'}).then(r=>console.log(r.status,r.headers.get('location')))"
curl -X POST https://assistant-mk1.vercel.app/api/threads \
  -H "Content-Type: application/json" \
  -d '{}'
SMOKE_TIMEOUT_MS=30000 SMOKE_BASE_URL=https://assistant-mk1.vercel.app pnpm smoke:workbench
```

The workbench smoke may need the longer timeout when Fly is cold-starting.
Run `pnpm smoke:cloudflare-session-boundary` and
`pnpm smoke:cloudflare-chat-boundary` against the Worker after rebuilding the
current D1 schema to prove tenant-scoped session and thread ownership. Run
`pnpm smoke:cloudflare-policy-boundary` to prove Cloudflare gates chat
execution before proxying to Fly. Run `pnpm smoke:cloudflare-event-feed` to
prove the browser-visible activity source is backed by Cloudflare events, and
`pnpm smoke:cloudflare-event-stream` to prove those events can stream live from
Cloudflare.

## Runtime Dependency

Deploy `assistant-mk1-langgraph-dev` and the Cloudflare Worker before deploying
Vercel changes that point `LANGGRAPH_API_URL` at `/langgraph`. See
`docs/deployment-fly.md` and `docs/dev-infrastructure-readiness.md`.
