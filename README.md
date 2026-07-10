# Assistant-mk1

Assistant-mk1 is a production-oriented agent workbench for chat, long-running
workflows, tools, approvals, artifacts, and tenant-scoped operations. It keeps
the chat experience immediate while making execution state inspectable and
policy-controlled.

[Hosted workbench](https://assistant-mk1.vercel.app) | [Documentation](docs/README.md) | [Release readiness](docs/release-readiness.md)

## What It Provides

- Cloudflare Agents chat with fast local-new first paint and durable thread state.
- WorkOS authentication with organization, workspace, membership, and role boundaries.
- Code-first agent packs with typed prompts, tools, workflows, and smoke scenarios.
- Read-only tools behind explicit policy, approvals, runner metadata, and audit.
- Searchable execution history with tool calls, artifacts, traces, retry, cancel,
  and approval resume controls where supported.
- Signed external signals and callback-backed Fly/LangGraph execution for work
  that does not belong in the normal chat path.
- Sentry and first-party runtime traces across the Vercel, Cloudflare, and Fly surfaces.

The read-only 1.0 contract deliberately excludes external mutation, encrypted
credential brokerage, artifact blob storage, and retained customer-data
migrations. Those gates stay explicit rather than being implied by the UI.

## Architecture

| Surface          | Responsibility                                                                                                         |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Vercel / Next.js | WorkOS browser session, workbench UI, and signed same-origin API facades                                               |
| Cloudflare       | Application authorization, D1 control state, Durable Object chat/session state, policy, audit, events, and normal chat |
| Fly / LangGraph  | Graph-shaped workflows and signed heavy tool execution                                                                 |

Trusted tenant scope is always derived server-side. The browser never chooses
`userId`, `workspaceId`, `agentId`, or provider credentials.

See [architecture](docs/architecture.md), [tenancy](docs/tenancy.md), and the
[current topology](docs/diagrams/current-implementation-topology.mmd).

## Quick Start

Requirements:

- Node.js 22
- pnpm 10.33.0
- an OpenRouter API key

```bash
pnpm install --frozen-lockfile
cp .env.example .env.local
cp cloudflare/control-plane/.dev.vars.example cloudflare/control-plane/.dev.vars
```

Set `OPENROUTER_API_KEY` in both local environment files and make the local
transport tokens match. Initialize the disposable local D1 database once:

```bash
pnpm db:cloudflare:rebuild:local
```

This command drops local Worker tables. Do not use either rebuild command when
you need to preserve existing development data.

Start the complete workbench:

```bash
pnpm dev:workbench
```

| Service           | Local URL               |
| ----------------- | ----------------------- |
| Next.js workbench | `http://localhost:3000` |
| LangGraph         | `http://localhost:2024` |
| Cloudflare Worker | `http://localhost:8787` |

Local development can use the explicit `WORKBENCH_ALLOW_LOCAL_DEV_IDENTITY`
fallback from `.env.example`. Hosted deployments fail closed and require WorkOS.

## Agent Packs

Agent packs live under `agent-packs/*` and declare behavior, tools, workflows,
risk posture, UI metadata, and smoke scenarios in code. Validate a pack before
running it:

```bash
pnpm agent-packs:validate
pnpm agent-packs:inspect
pnpm agent-packs:smoke
```

See [Agent Packs](docs/agent-packs.md) and
[Agent Profile Authoring](docs/agent-profile-authoring.md).

## Verification

Fast local gate:

```bash
pnpm verify:fast
```

Complete repository gate, including the production build:

```bash
pnpm verify
```

Browser release gate (first run also needs `pnpm exec playwright install chromium`):

```bash
pnpm test:e2e
```

`pnpm test:e2e` uses an isolated local D1 fixture under `output/playwright/`.
It verifies the signed-out refresh contract and a trusted local session with a
delayed Worker handoff, workspace membership, and History recovery controls.
Run the complete code, build, and browser gate with:

```bash
pnpm release:check
```

Runtime changes should also run the affected smoke. The remote Cloudflare
minimum is:

```bash
CLOUDFLARE_CONTROL_PLANE_URL=<worker-url> \
CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN=<token> \
CLOUDFLARE_CONTROL_PLANE_FACADE_SIGNING_SECRET=<signing-secret> \
pnpm smoke:cloudflare-deploy-readiness
```

The real-session eval manifest is verified with
`pnpm eval:real-session-posture`. See [Evals](docs/evals.md) for the covered
runtime contracts.

## Repository Map

- `app/assistant.tsx`: assistant-ui and Cloudflare Agents runtime bridge.
- `app/api/workbench/*`: signed Vercel facades over Cloudflare.
- `components/assistant-ui/*`: reusable assistant-ui composition.
- `components/workbench/*`: product workbench, history, workspace, and Admin UI.
- `cloudflare/control-plane/*`: Worker, D1 schema, Durable Objects, policy, and audit.
- `backend/agent.ts`: LangGraph graph and provider seam.
- `agent-packs/*`: code-first agent packages.
- `scripts/smoke-*.ts`: service-boundary and tenant-isolation checks.
- `docs/README.md`: authoritative current-state and target-contract map.

## Deployment

Deploy the Cloudflare control plane and Fly runtime before a Vercel release that
depends on them. Use the checked-in runbooks:

- [Vercel](docs/deployment-vercel.md)
- [Cloudflare and local infrastructure](docs/dev-infrastructure-readiness.md)
- [Fly](docs/deployment-fly.md)

The current remote D1 schema is intentionally reset-based and disposable.
Forward-only migrations and retention remain a documented post-1.0 gate in
[Migrations and Retention](docs/migrations-and-retention.md).

## Contributing And Security

Read [CONTRIBUTING.md](CONTRIBUTING.md) before changing runtime boundaries.
Report vulnerabilities through the process in [SECURITY.md](SECURITY.md).

This repository uses pnpm. Do not update the lockfile with npm or yarn.
