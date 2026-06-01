This is a reusable agent workbench built from the [assistant-ui](https://github.com/assistant-ui/assistant-ui) LangGraph starter. It ships a minimal OpenRouter-backed agent (`backend/agent.ts`), a Next.js chat UI that streams from it, and the first runtime seams for hosted staging, external starts, cron creation, and interrupt resumes.

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
   - `LANGCHAIN_API_KEY` — only needed when pointing `LANGGRAPH_API_URL` at LangGraph Platform (cloud)

2. Install deps and run both the LangGraph backend and the Next.js frontend:

   ```bash
   pnpm install
   pnpm dev
   ```

   - `localhost:2024` — LangGraph dev server (serves the `agent` graph)
   - `localhost:3000` — Next.js app (proxies `/api/*` → `LANGGRAPH_API_URL`)

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
- `goal.md` — product goal, phases, and done bar
- `docs/architecture.md` — system shape and seams
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
- `docs/first-vertical-slice.md` — first implementation proof and acceptance criteria
- `docs/docs-completion-checklist.md` — build-ready/partial/deferred docs status
- `docs/dev-infrastructure-readiness.md` — Fly baseline and future Cloudflare dev resource checklist
- `docs/runtime.md` — threads, runs, interrupts, crons, and external signals
- `docs/tenancy.md` — user/workspace scoping and isolation rules
- `docs/deployment-fly.md` — Fly dev/staging workflow
- `docs/reference-apps/polymancer.md` — reference target for a demanding 24/7 tool-using agent
- `docs/reference-apps/deployment-agent.md` — operational reference target for deployment agents

## External signals

`POST /api/external-signals` is the token-protected ingress for outside systems. Set `EXTERNAL_SIGNAL_TOKEN`, then send:

```bash
curl -X POST http://localhost:3000/api/external-signals \
  -H "Authorization: Bearer $EXTERNAL_SIGNAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"start","input":{"messages":[{"role":"user","content":"Run a smoke test."}]}}'
```

See `docs/runtime.md` for start, resume, and cron payloads.

## Fly dev/staging

The first Fly target is a hosted staging runtime, not the primary editing environment. It runs Next and the LangGraph dev server together in one Machine for simple validation after feature slices. See `docs/deployment-fly.md`.
