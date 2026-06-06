# Vercel Frontend Deployment

Vercel is the hosted frontend target for the Next.js workbench shell.

## Current Shape

The current deployed flow is:

```text
Browser -> Vercel Next.js frontend
        -> Cloudflare Worker/D1 for workbench run control
        -> Fly LangGraph runtime executor for demo.inspect callbacks

Browser -> Vercel Next.js /api proxy
        -> Cloudflare /langgraph compatibility facade
        -> Cloudflare-owned simple chat runtime for normal messages
        -> Fly LangGraph runtime gateway only for explicit heavy escalation
```

Vercel owns frontend rendering and browser-facing API proxying. Cloudflare owns
run control, tenant state, simple chat runtime, chat sessions, chat thread
ownership, chat intents, chat policy decisions, and the control-plane activity
feed plus event stream. Fly owns LangGraph workflow execution and signed
executor work when Cloudflare escalates to heavy compute.

WorkOS AuthKit is the current hosted identity boundary. Vercel maps WorkOS
identity into trusted headers; the browser never sends tenant scope directly.
When AuthKit provides an `organizationId`, Vercel maps it to an internal
`workos-org:<organizationId>` account id. Cloudflare creates the account's
default workspace if needed and resolves the active workspace from D1. That is
the current B2B shape: a customer/company WorkOS organization owns one or more
assistant-mk1 workspaces, with one default workspace created first. During the
current pre-user development phase, a signed-in WorkOS session without an
organization gets a stable personal account id derived from the WorkOS
`user.id`, with a default workspace under that account.

## Required Environment

Set these in Vercel Production before deploying:

```bash
NEXT_PUBLIC_LANGGRAPH_ASSISTANT_ID=agent
LANGGRAPH_API_URL=https://assistant-mk1-dev-control-plane.david-erwin-cz68.workers.dev/langgraph
CLOUDFLARE_CONTROL_PLANE_URL=https://assistant-mk1-dev-control-plane.david-erwin-cz68.workers.dev
CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN=<secret>
WORKOS_CLIENT_ID=<secret>
WORKOS_API_KEY=<secret>
WORKOS_COOKIE_PASSWORD=<secret>
NEXT_PUBLIC_WORKOS_REDIRECT_URI=https://assistant-mk1.vercel.app/auth/callback
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
`userId`. WorkOS `organizationId` becomes `workos-org:<organizationId>` when
available; otherwise the pre-user dev fallback account id is
`workos-personal:<user-id>`. Cloudflare auto-bootstraps D1-backed user, default
workspace, initial membership, and default agent rows for the current pre-user
dev environment, then resolves the active workspace and active agent before
touching control-plane state. Cloudflare stores the OpenRouter key for
Cloudflare-native simple chat and the Fly gateway token as
`LANGGRAPH_UPSTREAM_TOKEN` for explicit LangGraph/Fly escalation. Browser
requests never provide tenant ids or agent
ids directly.

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
node -e "fetch('https://assistant-mk1.vercel.app/api/workbench/context').then(async r=>console.log(r.status, await r.text()))"
CLOUDFLARE_CONTROL_PLANE_URL=<remote-worker-url> \
CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN=<token> \
pnpm smoke:cloudflare-workspace-context
CLOUDFLARE_CONTROL_PLANE_URL=<remote-worker-url> \
CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN=<token> \
pnpm smoke:cloudflare-workbench-run
```

The unauthenticated workbench context check should return `401`. Hosted Vercel
workbench routes require a signed-in WorkOS browser session, so deploy-time
runtime smokes call the Worker directly with trusted WorkOS-shaped headers. The
workbench run smoke may need `SMOKE_TIMEOUT_MS=30000` when Fly is cold-starting.
Run `pnpm smoke:cloudflare-session-boundary` and
`pnpm smoke:cloudflare-chat-boundary` against the Worker after rebuilding the
current D1 schema to prove tenant-scoped session and thread ownership. Run
`pnpm smoke:cloudflare-policy-boundary` to prove Cloudflare gates chat
execution before any model call or heavy escalation. Run `pnpm smoke:cloudflare-event-feed` to
prove the browser-visible activity source is backed by Cloudflare events, and
`pnpm smoke:cloudflare-event-stream` to prove those events can stream live from
Cloudflare.

## Runtime Dependency

Deploy `assistant-mk1-langgraph-dev` and the Cloudflare Worker before deploying
Vercel changes that point `LANGGRAPH_API_URL` at `/langgraph`. See
`docs/deployment-fly.md` and `docs/dev-infrastructure-readiness.md`.
