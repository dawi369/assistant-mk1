# Dev Infrastructure Readiness

This checklist tracks the tiny dev infrastructure baseline for assistant-mk1.
The current remote Cloudflare scope is intentionally narrow: one Worker, one D1
database, the Vercel frontend, and the dedicated Fly LangGraph runtime gateway.

## Current Remote Baseline

- Fly runtime app: `assistant-mk1-langgraph-dev`
- Region: `fra`
- Runtime URL: `https://assistant-mk1-langgraph-dev.fly.dev`
- Runtime shape: one Fly Machine runs the gateway and LangGraph dev server.
- Vercel frontend: `https://assistant-mk1.vercel.app`
- Hosted auth: WorkOS AuthKit on Vercel; WorkOS `user.id` maps to internal
  `userId`. WorkOS `organizationId` maps to `workos-org:<organizationId>` when
  present. Pre-user sessions without an organization use
  `workos-personal:<user-id>`. Cloudflare creates the account's default
  workspace, stores the user's active workspace preference, and resolves the
  active workspace from D1.
- Required smoke: `CLOUDFLARE_CONTROL_PLANE_URL=<remote-worker-url> CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN=<token> pnpm smoke:cloudflare-workbench-run`
- Cloudflare Worker: `assistant-mk1-dev-control-plane`
- Cloudflare D1 database: `assistant_mk1_dev`
- D1 binding: `DB`
- Sentry: org `t23`, project `assistant-mk1`. Vercel and Cloudflare share the
  project and are separated by `runtime.surface` tags.
- Workbench smoke aliases:
  - `pnpm smoke:workbench` uses the Vercel/Next same-origin workbench route and
    is for local dev fallback or a future authenticated browser/session harness.
  - `pnpm smoke:cloudflare-workbench-run` calls the Worker directly with
    trusted WorkOS-shaped headers and is the hosted deploy runtime smoke.

The Vercel frontend uses the same Cloudflare-owned workbench routes. Its
LangGraph proxy points at the Cloudflare `/langgraph` facade, which
authenticates Vercel with the dev control-plane token and then authenticates to
the Fly gateway with `LANGGRAPH_UPSTREAM_TOKEN`.

Hosted Vercel requests derive tenant scope from the WorkOS server session.
Users must complete WorkOS sign-in before the workbench can call Cloudflare.
When WorkOS provides an organization, that organization is treated as the
customer/company account source. During the current pre-user phase, sessions
without an organization use a stable personal account fallback. Cloudflare
auto-bootstraps D1-backed user, default workspace, initial active membership,
and default agent rows for the current dev environment. Hosted WorkOS traffic
does not use `WORKBENCH_DEV_WORKSPACE_ID` or `WORKBENCH_DEV_AGENT_ID`;
Cloudflare resolves the active workspace and active agent from D1, falling back
to account/workspace defaults when no user preference exists.

Normal chat/session state is Cloudflare-owned. `WorkbenchSessionAgent` owns
session snapshots, recent thread summaries, active-thread selection, and the
short-lived session event stream. `WorkbenchThreadChatAgent` owns per-thread
hot messages and streaming. D1 mirrors compact chat run, policy, trace,
tool-runner, and event metadata for Admin visibility. The `/langgraph` facade
remains for compatibility and explicit Fly/LangGraph delegation, not the normal
chat path.

## Toolchain And CI

- Package manager: `pnpm@10.33.0`, pinned in `package.json`.
- pnpm project settings live in `pnpm-workspace.yaml`. pnpm v11 no longer reads
  the legacy `package.json` `pnpm` settings field, so overrides and run checks
  belong in the workspace file.
- `verifyDepsBeforeRun: warn` keeps normal `pnpm <script>` commands usable in
  non-TTY agent sessions even when local `node_modules` metadata is stale.
- GitHub Actions verification lives in `.github/workflows/verify.yml` and runs
  a clean install, agent-pack validation, focused workflow/tool-policy tests,
  typecheck, lint, and build on push/PR.

If local commands warn that `node_modules` is out of sync, a deliberate
`pnpm install` refreshes the local metadata. Do not run install just to silence
the warning during unrelated repo analysis.

## Fly Configuration

Required secrets:

- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL`
- `WORKBENCH_EXECUTOR_TOKEN`
- `WORKBENCH_RUNNER_SIGNING_SECRET`
- `WORKBENCH_CALLBACK_SIGNING_SECRET`
- `LANGGRAPH_PROXY_TOKEN`

Optional secrets:

- `LANGSMITH_API_KEY`
- `LANGSMITH_TRACING`
- `LANGSMITH_PROJECT`
- `SENTRY_DSN`
- `SENTRY_ENVIRONMENT`
- `SENTRY_TRACES_SAMPLE_RATE`

Committed Fly env:

- `LANGGRAPH_PORT=2024`
- `LANGGRAPH_UPSTREAM_URL=http://127.0.0.1:2024`
- `OPENROUTER_APP_NAME=assistant-mk1-langgraph-dev`
- `OPENROUTER_SITE_URL=https://assistant-mk1-langgraph-dev.fly.dev`

## Local Cloudflare Control Plane

The local Cloudflare loop uses Wrangler with a local D1 binding named `DB` and
the same Worker run-control routes as remote dev. It remains the cheapest inner
loop for Worker changes.

Local commands:

```bash
cat > cloudflare/control-plane/.dev.vars <<'EOF'
CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN=local-dev-token
LANGGRAPH_UPSTREAM_URL=http://127.0.0.1:2024
LANGGRAPH_UPSTREAM_TOKEN=local-langgraph-proxy-token
SENTRY_DSN=
SENTRY_ENVIRONMENT=development
SENTRY_TRACES_SAMPLE_RATE=1.0
WORKBENCH_EXECUTOR_URL=http://localhost:3000/api/workbench/executors/demo-inspect
WORKBENCH_EXECUTOR_TOKEN=local-executor-token
WORKBENCH_CALLBACK_SIGNING_SECRET=local-callback-signing-secret
EOF
pnpm db:cloudflare:rebuild:local
pnpm dev:cloudflare
```

The rebuild command is destructive for local dev D1 state.

In another terminal, run the Next app and local LangGraph dev server with:

```bash
CLOUDFLARE_CONTROL_PLANE_URL=http://localhost:8787 \
CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN=local-dev-token \
LANGGRAPH_UPSTREAM_TOKEN=local-langgraph-proxy-token \
WORKBENCH_EXECUTOR_TOKEN=local-executor-token \
WORKBENCH_DEV_USER_ID=dev-user \
WORKBENCH_DEV_WORKSPACE_ID=dev-workspace \
WORKBENCH_DEV_AGENT_ID=dev-agent \
pnpm dev
```

Then smoke the same Cloudflare-owned path locally:

```bash
SMOKE_BASE_URL=http://localhost:3000 pnpm smoke:workbench
```

That smoke starts at the Next proxy, creates the run in the local Cloudflare
Worker, delegates execution to the signed Next executor, receives callbacks,
and reads the completed run snapshot from D1-owned Cloudflare state.

To prove D1 tenant isolation at the Worker boundary, run:

```bash
pnpm smoke:tenant-isolation
pnpm smoke:cloudflare-authz
pnpm smoke:cloudflare-workspace-context
pnpm smoke:cloudflare-workspaces
pnpm smoke:cloudflare-membership-policy
pnpm smoke:cloudflare-agent-selection
pnpm smoke:cloudflare-admin-summary
pnpm smoke:cloudflare-session-boundary
pnpm smoke:cloudflare-chat-boundary
pnpm smoke:cloudflare-policy-boundary
pnpm smoke:cloudflare-event-feed
pnpm smoke:cloudflare-event-stream
```

Those smokes use two trusted dev tenant identities. They verify each tenant sees
only its own workbench runs, chat sessions, and LangGraph chat threads. The
authz smoke verifies the WorkOS-shaped no-agent-header path auto-bootstraps
D1-backed user/workspace/membership/default-agent rows, reuses the active
agent, rejects disabled membership, and hides cross-workspace sessions. The
workspace, membership-policy, agent-selection, and admin-summary smokes verify
Cloudflare-owned workspace activation, D1-owned membership authorization,
active-agent preferences, and the Admin summary path. The
workspace-context smoke verifies the same resolved identity is exposed safely
for Admin before any demo run exists. The policy smoke also verifies
that normal `ask` chat passes, `execute` chat is
blocked, and duplicate same-thread execution is rejected while a run is already
`running`. The event-feed smoke verifies tenant-scoped progress events and the
`after` cursor route. The event-stream smoke verifies the same progress can be
observed over the Worker SSE stream.

The local Worker code is split by responsibility: route dispatch, HTTP/auth
helpers, Cloudflare-owned demo-run handlers, and D1-backed demo run storage.

## Remote Cloudflare Control Plane

The remote dev baseline proves this production-shaped path:

```text
Vercel Next proxy -> remote Cloudflare Worker -> remote D1
                  -> signed Fly runtime executor
                  -> Worker callbacks -> remote D1 snapshot
```

Provisioning and deploy commands:

```bash
pnpm wrangler d1 list
pnpm wrangler d1 create assistant_mk1_dev --config cloudflare/control-plane/wrangler.jsonc
pnpm db:cloudflare:rebuild:remote
pnpm deploy:cloudflare
```

The rebuild command is destructive for remote dev D1 state. That is intentional
while this schema is still early-dev and disposable.

During the current pre-production framework phase, destructive remote dev D1
rebuilds are welcome when they keep the live schema aligned with the checked-in
control-plane contract. Treat `assistant_mk1_dev` as disposable validation
state until the project explicitly introduces a migration system and promotes
remote data retention to a requirement. The production gate for that handoff is
tracked in `docs/migrations-and-retention.md`.

Only run `d1 create` when `assistant_mk1_dev` is missing. After creation, copy
the returned `database_id` into `cloudflare/control-plane/wrangler.jsonc`.

Remote Worker secrets and vars:

```bash
pnpm wrangler secret put CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN --config cloudflare/control-plane/wrangler.jsonc
pnpm wrangler secret put CLOUDFLARE_CONTROL_PLANE_FACADE_SIGNING_SECRET --config cloudflare/control-plane/wrangler.jsonc
pnpm wrangler secret put LANGGRAPH_UPSTREAM_TOKEN --config cloudflare/control-plane/wrangler.jsonc
pnpm wrangler secret put WORKBENCH_EXECUTOR_TOKEN --config cloudflare/control-plane/wrangler.jsonc
pnpm wrangler secret put WORKBENCH_EXECUTOR_URL --config cloudflare/control-plane/wrangler.jsonc
pnpm wrangler secret put WORKBENCH_CALLBACK_SIGNING_SECRET --config cloudflare/control-plane/wrangler.jsonc
pnpm wrangler secret put WORKBENCH_RUNNER_TRANSPORT --config cloudflare/control-plane/wrangler.jsonc
pnpm wrangler secret put WORKBENCH_RUNNER_URL --config cloudflare/control-plane/wrangler.jsonc
pnpm wrangler secret put WORKBENCH_RUNNER_SIGNING_SECRET --config cloudflare/control-plane/wrangler.jsonc
pnpm wrangler secret put SENTRY_DSN --config cloudflare/control-plane/wrangler.jsonc
```

Use
`https://assistant-mk1-langgraph-dev.fly.dev/workbench/executors/demo-inspect`
as the remote executor URL. Do not commit token values.

Use
`https://assistant-mk1-langgraph-dev.fly.dev/workbench/tool-runners/invocations`
as the remote runner URL when enabling `WORKBENCH_RUNNER_TRANSPORT=fly`.
`WORKBENCH_RUNNER_SIGNING_SECRET` must match the Fly secret with the same name.
When the transport, URL, or secret is absent, the Worker keeps `url.inspect` on
the Cloudflare-inline runner.

Verify runner transport without printing secrets by setting the secret only in
the command environment:

```bash
LANGGRAPH_RUNTIME_BASE_URL=https://assistant-mk1-langgraph-dev.fly.dev \
WORKBENCH_RUNNER_SIGNING_SECRET=<runner-secret> \
pnpm smoke:fly-tool-runner
```

Fly machine health uses the shallow `GET /health/live` endpoint. The deeper
`GET /health` endpoint still checks LangGraph readiness and is the right manual
check when debugging runtime boot or proxy behavior.

`LANGGRAPH_UPSTREAM_URL` is committed in `wrangler.jsonc` and points at
`https://assistant-mk1-langgraph-dev.fly.dev`. `LANGGRAPH_UPSTREAM_TOKEN` must
match the Fly `LANGGRAPH_PROXY_TOKEN`.

`CLOUDFLARE_CONTROL_PLANE_FACADE_SIGNING_SECRET` must match the Vercel
Production environment variable with the same name. When this secret is present,
normal control-plane facade routes require fresh signed requests and reject
stale or replayed nonces. Local `wrangler dev` can keep using the dev token only
when this signing secret is absent or `CLOUDFLARE_CONTROL_PLANE_REQUIRE_FACADE_SIGNATURE=false`.

`SENTRY_ENVIRONMENT=production` is committed for the deployed Worker. Keep
`SENTRY_DSN` out of source and configure it as a Worker secret.
`SENTRY_TRACES_SAMPLE_RATE=0.02` is committed for the deployed Worker to keep
production telemetry low-noise.

Cloudflare LangGraph facade smoke:

```bash
CLOUDFLARE_CONTROL_PLANE_URL=<remote-worker-url> \
CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN=<token> \
pnpm smoke:cloudflare-langgraph-facade
```

Cloudflare workspace context smoke:

```bash
CLOUDFLARE_CONTROL_PLANE_URL=<remote-worker-url> \
CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN=<token> \
pnpm smoke:cloudflare-workspace-context
```

Cloudflare chat boundary smoke:

```bash
CLOUDFLARE_CONTROL_PLANE_URL=<remote-worker-url> \
CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN=<token> \
pnpm smoke:cloudflare-chat-boundary
```

Cloudflare session boundary smoke:

```bash
CLOUDFLARE_CONTROL_PLANE_URL=<remote-worker-url> \
CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN=<token> \
pnpm smoke:cloudflare-session-boundary
```

Cloudflare policy boundary smoke:

```bash
CLOUDFLARE_CONTROL_PLANE_URL=<remote-worker-url> \
CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN=<token> \
pnpm smoke:cloudflare-policy-boundary
```

Cloudflare event feed smoke:

```bash
CLOUDFLARE_CONTROL_PLANE_URL=<remote-worker-url> \
CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN=<token> \
pnpm smoke:cloudflare-event-feed
```

Cloudflare event stream smoke:

```bash
CLOUDFLARE_CONTROL_PLANE_URL=<remote-worker-url> \
CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN=<token> \
pnpm smoke:cloudflare-event-stream
```

Remote deploy readiness smoke:

```bash
CLOUDFLARE_CONTROL_PLANE_URL=<remote-worker-url> \
CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN=<token> \
CLOUDFLARE_CONTROL_PLANE_FACADE_SIGNING_SECRET=<same-secret-as-worker> \
pnpm smoke:cloudflare-deploy-readiness
```

This composed smoke is the minimum approval/tool-policy deploy gate. It runs
workspace context, Admin tool policy/approval lifecycle, policy boundary,
session boundary, and live event-stream coverage against the same Worker URL.

Remote Worker smoke:

```bash
CLOUDFLARE_CONTROL_PLANE_URL=<remote-worker-url> \
CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN=<token> \
pnpm smoke:cloudflare-workbench-run
```

`pnpm smoke:cloudflare-workbench-run` is the hosted deploy runtime smoke. It
calls the Worker directly because hosted Vercel workbench routes require a
signed-in WorkOS browser session. `pnpm smoke:workbench` remains useful for
local same-origin testing when the Next app is using local dev identity
fallbacks.

The browser-visible `Run demo inspect` button uses the Cloudflare-owned route by
default. Missing Cloudflare configuration should fail visibly; there is no
secondary local demo route.

Tenant scope for the hosted Vercel baseline is server-derived from WorkOS
AuthKit. Vercel/Next maps WorkOS `user.id` to internal `userId` and WorkOS
`organizationId` to `workos-org:<organizationId>` when present. During pre-user
development, signed-in WorkOS sessions without an organization fall back to a
stable `workos-personal:<user-id>` account. Vercel forwards those values and
safe user/membership metadata to the Worker as trusted headers. Cloudflare
resolves the active workspace, membership, and active agent from D1 before
reading or writing control-plane state. Browser requests never choose tenant
scope, workspace identity, or agent identity. In the B2B north star,
WorkOS organizations represent customer or company account sources; one account
has one default workspace now and can have multiple workspaces later. The WorkOS
client id and API key must come from the same WorkOS app/environment, and the
Vercel Production redirect URI must be
`https://assistant-mk1.vercel.app/auth/callback`.

Local development can still fall back to `WORKBENCH_DEV_USER_ID` and
`WORKBENCH_DEV_WORKSPACE_ID` when WorkOS is not configured. That fallback is
for local smoke convenience only; hosted Vercel should use WorkOS session
identity.

## Local Tool Adapter Foundation

The first tool adapter slice uses an in-process runtime registry and exposure
resolver. `demo.inspect` is exposed only for dry-run observe workflows. This is
the server-side seam that future Cloudflare/Fly tool execution should preserve;
it is not a durable tool registry or permission store yet.

## Future Cloudflare Resources

The Worker and D1 resources above are now the remote dev baseline. Do not create
R2, Durable Object, Access, or production auth resources until the first
remote-backed repository group is explicitly scoped.

Planned dev resource names:

- R2 bucket: `assistant-mk1-dev-artifacts`
- Durable Object namespace: `ASSISTANT_MK1_DEV_AGENTS`

Planned bindings:

- `ARTIFACTS` for R2 artifact blobs.
- `AGENTS` for per-agent hot coordination state.

## Provisioning Gates

Before creating additional Cloudflare resources, define:

- Which `AgentFrameworkDataClient` repository group is implemented first.
- The richer production authorization policy beyond current WorkOS-backed
  membership policy and agent routing.
- The minimum D1 tables or Durable Object storage required for that repository
  group.
- The R2 object key convention for artifact metadata produced by the demo slice.
- A smoke command that proves two dev tenants cannot read each other's state.

## Out Of Scope For This Step

- Production authorization policy beyond WorkOS sign-in.
- Secret custody implementation.
- R2 schema/resource provisioning.
- Durable Object provisioning.
- Direct D1/R2 access from Fly or LangGraph workers.
- Mutation-capable tools.
- Cloudflare Agent, R2, or Durable Object deployment.
