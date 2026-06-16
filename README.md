# Assistant-mk1

Assistant-mk1 is a production-oriented agent workbench built from the
[assistant-ui](https://github.com/assistant-ui/assistant-ui) LangGraph starter.
The default screen is still the assistant-ui chat surface, but the runtime is
being shaped around a stricter hosted boundary:

- Vercel owns the Next.js web app and WorkOS-backed browser session.
- Cloudflare owns app authorization, workspace/agent resolution, control-plane
  state, normal chat coordination, and Admin/runtime summaries.
- Fly/LangGraph remain the heavy execution plane for graph-shaped workflows and
  server-side tool runners.

The repo is still pre-user and the Cloudflare dev schema is rebuildable, but
tenant scope, membership, workspace, thread, and agent routing are already
server-derived instead of browser supplied.

## Quickstart

```bash
cp .env.example .env.local
pnpm install
pnpm dev
```

Minimum local chat requires `OPENROUTER_API_KEY`. WorkOS, Cloudflare,
LangSmith, Sentry, and local fallback identity settings are documented in
`.env.example`.

Local ports:

- `localhost:3000`: Next.js workbench
- `localhost:2024`: LangGraph dev server
- `localhost:8787`: Cloudflare Worker when `pnpm dev:cloudflare` is running

Use pnpm for dependency and script commands; `pnpm-lock.yaml` is the package
manager source of truth.

## Verify

Run the narrowest useful checks for each change:

```bash
pnpm typecheck
pnpm lint
pnpm build
```

Runtime work should also smoke the relevant surface. For the basic web app:

```bash
pnpm dev
curl http://localhost:3000/api/health
```

Cloudflare D1 rebuild commands are intentionally destructive because
`cloudflare/control-plane/schema.sql` starts by dropping dev tables. Do not run
local or remote rebuilds unless you are deliberately resetting dev state.

## Project Map

- `app/assistant.tsx`: frontend runtime bridge between assistant-ui and
  Cloudflare Agents.
- `components/assistant-ui/*`: reusable assistant-ui components.
- `components/workbench/*`: product-specific workbench shell and Admin surfaces.
- `backend/agent.ts`: LangGraph graph/provider seam.
- `app/api/[..._path]/route.ts`: LangGraph API proxy.
- `app/api/workbench/*`: same-origin Vercel facades over Cloudflare.
- `cloudflare/control-plane/*`: Worker, D1 schema, Durable Object Agents, and
  control-plane handlers.
- `scripts/smoke-*.ts`: targeted runtime and boundary smoke checks.
- `docs/README.md`: authoritative docs map and document-status guide.

## Operating Docs

Start with `docs/README.md`. Product direction belongs in
`docs/agent-workbench.md`, implementation sequencing belongs in
`docs/implementation-roadmap.md`, and reference-app pressure belongs in
`docs/reference-apps/*`.

Deployment runbooks live in `docs/deployment-vercel.md`,
`docs/deployment-fly.md`, and `docs/dev-infrastructure-readiness.md`.
