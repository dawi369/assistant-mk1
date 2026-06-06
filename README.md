# Assistant-mk1

Assistant-mk1 is a reusable agent workbench built from the
[assistant-ui](https://github.com/assistant-ui/assistant-ui) LangGraph starter.
It keeps assistant-ui as the default chat surface while Vercel, WorkOS,
Cloudflare, Fly, and LangGraph are being shaped into a production-oriented
runtime boundary.

Current hosted development uses WorkOS AuthKit at the Vercel web boundary,
Cloudflare Worker/D1 for app authorization and control-plane state, and Fly for
LangGraph/tool execution. The codebase is still pre-user and schema-rebuildable,
but tenant scope, membership, workspace, and agent routing are already
server-derived instead of browser supplied.

## Getting Started

1. Copy env template and fill in secrets:

   ```bash
   cp .env.example .env.local
   ```

   Required:
   - `OPENROUTER_API_KEY` — used by `backend/agent.ts`

   Optional:
   - `OPENROUTER_MODEL` — override the default model id
   - `OPENROUTER_SITE_URL` / `OPENROUTER_APP_NAME` — OpenRouter attribution metadata
   - `LANGSMITH_TRACING` / `LANGSMITH_API_KEY` / `LANGSMITH_PROJECT` — tracing
   - `WORKOS_*` — hosted sign-in with WorkOS AuthKit
   - `CLOUDFLARE_CONTROL_PLANE_*` — local or hosted Worker facade/authz path
   - `WORKBENCH_DEV_*` — local fallback identity when WorkOS is not configured

2. Install deps and run both the LangGraph backend and the Next.js frontend:

   ```bash
   pnpm install
   pnpm dev
   ```

   - `localhost:2024` — LangGraph dev server (serves the `agent` graph)
   - `localhost:3000` — Next.js app (proxies `/api/*` to `LANGGRAPH_API_URL`)

   Run them individually with `pnpm dev:backend` and `pnpm dev:frontend`.

   This repo uses pnpm because it is faster, works well for future workspace/package extraction, and `pnpm-lock.yaml` is the package-manager source of truth.

3. Verify local changes:

   ```bash
   pnpm typecheck
   pnpm build
   pnpm lint
   ```

## Project layout

```
app/                Next.js App Router pages + /api proxy
app/api/[..._path]/ Next.js catch-all proxy for LangGraph API requests
backend/agent.ts    LangGraph graph exported as `graph`
docs/               repo-native operating docs
lib/chatApi.ts      LangGraph SDK client factory
langgraph.json      LangGraph CLI config (graph id, node version, env file)
```

`app/assistant.tsx` builds the runtime with `unstable_createLangGraphStream({ client, assistantId })` from `@assistant-ui/react-langgraph`.

`app/api/[..._path]/route.ts` uses Next.js catch-all route syntax. The bracketed folder is intentionally named that way: it lets one route receive `/api/threads`, `/api/threads/:id/runs`, and other LangGraph API paths, then proxy them to `LANGGRAPH_API_URL`.

## Operating docs

- `AGENTS.md` — repo instructions for coding agents
- `docs/README.md` — docs map that separates current implementation from target architecture
- `docs/architecture.md` — system shape and seams
- `docs/diagrams/README.md` — git-tracked Mermaid topology diagram workflow
- `docs/implementation-roadmap.md` — staged path from current starter to target workbench
- `docs/infrastructure.md` — infrastructure topology and request flow
- `docs/cloudflare-control-plane.md` — target live multi-user control plane
- `docs/fly-tool-runners.md` — heavy tool and workflow execution plane
- `docs/data-and-state.md` — storage responsibilities and canonical entities
- `docs/db-contracts.md` — durable entity contracts and data-client boundaries
- `docs/run-lifecycle.md` — run status, child runs, interrupts, cancellation, and durable outputs
- `docs/tool-system.md` — tool registration, exposure, execution, adapters, artifacts, and redaction
- `docs/policy-model.md` — execution modes, approvals, limits, kill switches, and mutation gates
- `docs/context-assembly.md` — stable/scoped/retrieved/volatile model context algorithm
- `docs/control-plane-api.md` — operation-level control-plane API contracts
- `docs/secrets-and-risk.md` — secret custody, execution modes, and production gates
- `docs/agent-workbench.md` — reusable workbench UX model
- `docs/workbench-ui.md` — assistant-ui leverage map and workbench surfaces
- `docs/context-engineering.md` — decision records and provenance-backed recall
- `docs/observability-and-audit.md` — lifecycle events, audit records, logs, artifacts, and health
- `docs/dev-infrastructure-readiness.md` — Vercel/Fly/Cloudflare dev baseline and resource checklist
- `docs/runtime.md` — threads, runs, interrupts, crons, and external signals
- `docs/tenancy.md` — user/workspace scoping and isolation rules
- `docs/deployment-vercel.md` — Vercel frontend deployment workflow
- `docs/deployment-fly.md` — Fly dev/staging workflow
- `docs/reference-apps/polymancer.md` — reference target for a demanding 24/7 tool-using agent
- `docs/reference-apps/deployment-agent.md` — operational reference target for deployment agents
- `docs/reference-apps/personal-job-agent.md` — personal job-search reference target with browser automation and policy-controlled applications

Product direction lives in `docs/agent-workbench.md`, implementation sequencing
lives in `docs/implementation-roadmap.md`, and downstream app pressure is
captured in `docs/reference-apps/*`.

## External signals

`POST /api/external-signals` is the token-protected ingress for outside systems. Set `EXTERNAL_SIGNAL_TOKEN`, then send:

```bash
curl -X POST http://localhost:3000/api/external-signals \
  -H "Authorization: Bearer $EXTERNAL_SIGNAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"start","input":{"messages":[{"role":"user","content":"Run a smoke test."}]}}'
```

See `docs/runtime.md` for start, resume, and cron payloads.

## Hosted dev/staging

The active hosted dev baseline is split by responsibility:

- Vercel hosts the Next.js frontend and same-origin browser API facade.
- Vercel uses WorkOS AuthKit for hosted sign-in and derives trusted tenant
  scope server-side before calling Cloudflare.
- Cloudflare owns durable workbench run control, tenant/session state, audit
  records, and D1-backed snapshots.
- Fly runs the LangGraph runtime gateway and signed server-side executors.

See `docs/deployment-vercel.md`, `docs/deployment-fly.md`, and
`docs/dev-infrastructure-readiness.md`.
