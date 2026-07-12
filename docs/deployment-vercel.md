# Vercel Frontend Deployment

Vercel is the hosted frontend target for the Next.js workbench shell.

## Current Shape

The current deployed flow is:

```text
Browser -> Vercel Next.js frontend
        -> Cloudflare Worker/D1 for workbench run, session, and tool control
        -> Fly runtime gateway for signed heavy execution/tool runners

Browser -> Vercel Next.js /api proxy
        -> Cloudflare Agents for normal chat
        -> Cloudflare /langgraph compatibility facade only when needed
        -> Fly LangGraph/runtime gateway for explicit heavy escalation
```

Vercel owns frontend rendering and browser-facing API proxying. Cloudflare owns
run control, tenant state, Cloudflare Agents chat, chat sessions, chat thread
ownership, chat intents, chat policy decisions, tool policy, callbacks, and the
control-plane activity feed plus event stream. Fly owns LangGraph workflow
execution and signed runner work when Cloudflare escalates to heavy compute.

WorkOS AuthKit is the current hosted identity boundary. Vercel maps WorkOS
identity into trusted headers; the browser never sends tenant scope directly.
When AuthKit provides an `organizationId`, Vercel maps it to an internal
`workos-org:<organizationId>` account id. Cloudflare creates the account's
default workspace if needed and resolves the active workspace from D1. That is
the current B2B shape: a customer/company WorkOS organization owns one or more
assistant-mk1 workspaces, with one default workspace created first. During the
current read-only release, a signed-in WorkOS session without an
organization gets a stable personal account id derived from the WorkOS
`user.id`, with a default workspace under that account.

## Required Environment

Set these in Vercel Production before deploying:

```bash
NEXT_PUBLIC_LANGGRAPH_ASSISTANT_ID=agent
LANGGRAPH_API_URL=https://assistant-mk1-dev-control-plane.david-erwin-cz68.workers.dev/langgraph
CLOUDFLARE_CONTROL_PLANE_URL=https://assistant-mk1-dev-control-plane.david-erwin-cz68.workers.dev
CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN=<secret>
CLOUDFLARE_CONTROL_PLANE_FACADE_SIGNING_SECRET=<same-secret-as-worker>
WORKOS_CLIENT_ID=<secret>
WORKOS_API_KEY=<secret>
WORKOS_COOKIE_PASSWORD=<secret>
NEXT_PUBLIC_WORKOS_REDIRECT_URI=https://assistant-mk1.vercel.app/auth/callback
WORKBENCH_ADMIN_USER_IDS=<comma-separated-workos-user-ids>
WORKBENCH_ADMIN_EMAILS=<comma-separated-admin-emails>
```

`WORKOS_CLIENT_ID` and `WORKOS_API_KEY` must belong to the same WorkOS
environment/application. A mismatched key pair causes `/auth/callback` to fail
with WorkOS `invalid_client` / `Invalid client secret` after the upstream
identity provider sign-in succeeds.

`WORKBENCH_ADMIN_USER_IDS` and `WORKBENCH_ADMIN_EMAILS` gate the local `/admin`
composer command and centered Admin panel. Use WorkOS user ids when available;
email allowlisting is acceptable for local development; production should use
stable WorkOS user ids.

Do not mirror local `.env.local` into Vercel Production blindly:

- Local redirect URI: `http://localhost:3000/auth/callback`
- Production redirect URI: `https://assistant-mk1.vercel.app/auth/callback`

The Vercel `/api` proxy authenticates to Cloudflare with a signed facade
request. `CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN` remains the shared transport
token for current dev operations, but Cloudflare trusts WorkOS-derived identity
headers only when the request signature is fresh and non-replayed. WorkOS
`user.id` becomes the internal `userId`. WorkOS `organizationId` becomes
`workos-org:<organizationId>` when available; otherwise the personal fallback
account id is
`workos-personal:<user-id>`. Cloudflare auto-bootstraps D1-backed user, default
workspace, initial membership, and default agent rows, then resolves the active
workspace and active agent before touching control-plane state. Owners and
admins manage workspace membership through the normal workbench surface;
Cloudflare enforces those changes against D1. Cloudflare stores the OpenRouter key for
Cloudflare-native simple chat and the Fly gateway token as
`LANGGRAPH_UPSTREAM_TOKEN` for explicit LangGraph/Fly escalation. Browser
requests never provide tenant ids or agent
ids directly.

## Deploy

The repo lockfile is generated with pnpm 10. Keep `packageManager` pinned to
`pnpm@10.33.0`; pnpm 11 can fail Vercel install because ignored dependency
build scripts become install errors. pnpm workspace settings and overrides
belong in `pnpm-workspace.yaml`, not the legacy `package.json` `pnpm` field.

When a deployed slice changes the remote D1 schema, rebuild the remote dev D1
database before deploying Vercel. `assistant_mk1_dev` is intentionally
disposable in the current pre-production phase; destructive rebuilds are
expected until the migration and retention gate in
`docs/migrations-and-retention.md` is implemented.

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
CLOUDFLARE_CONTROL_PLANE_FACADE_SIGNING_SECRET=<same-secret-as-worker> \
pnpm smoke:cloudflare-workspace-context
CLOUDFLARE_CONTROL_PLANE_URL=<remote-worker-url> \
CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN=<token> \
CLOUDFLARE_CONTROL_PLANE_FACADE_SIGNING_SECRET=<same-secret-as-worker> \
pnpm smoke:cloudflare-workbench-run
```

The unauthenticated workbench context check should return `401`. Hosted Vercel
workbench routes require a signed-in WorkOS browser session, so deploy-time
runtime smokes call the Worker directly with trusted WorkOS-shaped headers. The
workbench run smoke may need `SMOKE_TIMEOUT_MS=30000` when Fly is cold-starting.
Run `pnpm smoke:cloudflare-deploy-readiness` against the Worker after
rebuilding the current D1 schema. It composes the minimum remote deploy suite:
workspace context, Admin tool policy/approvals, policy boundary, session
boundary, and live event stream coverage. Run broader chat or workbench smokes
when the touched slice changes those paths.

## Approval/tool policy deploy validation

For approval or model-exposure changes, use this remote-dev order:

```bash
PATH=/opt/homebrew/bin:$PATH pnpm typecheck
PATH=/opt/homebrew/bin:$PATH pnpm test:unit
PATH=/opt/homebrew/bin:$PATH pnpm lint
PATH=/opt/homebrew/bin:$PATH SENTRY_AUTH_TOKEN= pnpm build
PATH=/opt/homebrew/bin:$PATH pnpm db:cloudflare:migrate:remote
PATH=/opt/homebrew/bin:$PATH pnpm deploy:cloudflare
CLOUDFLARE_CONTROL_PLANE_URL=<remote-worker-url> \
CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN=<token> \
CLOUDFLARE_CONTROL_PLANE_FACADE_SIGNING_SECRET=<same-secret-as-worker> \
PATH=/opt/homebrew/bin:$PATH pnpm smoke:cloudflare-deploy-readiness
vercel --prod --yes
curl https://assistant-mk1.vercel.app/api/health
node -e "fetch('https://assistant-mk1.vercel.app/sign-in',{redirect:'manual'}).then(r=>console.log(r.status,r.headers.get('location')))"
```

`pnpm db:cloudflare:migrate:remote` applies only unapplied forward migrations.
The separate rebuild command remains destructive and is not part of a normal
deploy.

Hosted Admin manual QA after sign-in:

- Owner/admin sees Tools and the Approval queue.
- Approval-required `url.inspect` creates a pending request.
- Approve executes the original URL and records a tool call/artifact.
- Deny cancels without creating a tool call/artifact.
- Disabled policy blocks approve while deny still works.
- Member users cannot list or act on approvals.
- Another tenant sees no cross-tenant approvals, runs, artifacts, or policy.
- `modelVisible=true` exposes only read-only `url.inspect` when approval is not
  required.

## Runtime Dependency

Deploy `assistant-mk1-langgraph-dev` and the Cloudflare Worker before deploying
Vercel changes that point `LANGGRAPH_API_URL` at `/langgraph`. See
`docs/deployment-fly.md` and `docs/dev-infrastructure-readiness.md`.
