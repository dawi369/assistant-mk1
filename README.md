# Assistant-mk1

A code-first agent workbench for durable runs, approvals, tool policy, artifacts,
audit, and tenant-safe operations.

[![Version](https://img.shields.io/badge/version-1.0.0-111827)](#release-status)
[![Verify](https://github.com/dawi369/assistant-mk1/actions/workflows/verify.yml/badge.svg)](https://github.com/dawi369/assistant-mk1/actions/workflows/verify.yml)
[![License](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-2563eb)](LICENSE)

[Hosted workbench](https://assistant-mk1.vercel.app) ·
[Documentation](docs/README.md) ·
[Release readiness](docs/release-readiness.md)

## Release Status

Assistant-mk1 is under active development and is not ready for public release.
The repository is pinned at version `1.0.0` as its current product baseline; that
version is not a release announcement or a promise of retained production data.

The implemented surface is an authenticated, read-only workbench. External
mutation, encrypted credential brokerage, artifact blob storage, and retained
customer-data migrations remain explicit production gates.

## Product Tour

Assistant-mk1 keeps chat immediate while moving serious agent work into durable,
inspectable control-plane state. Runs, tools, approvals, artifacts, traces, and
tenant scope are visible outside the model conversation.

![Repository Analyst chat with pack-specific starters](docs/assets/readme/workbench-overview.png)

### Workbench

- Cloudflare Agents chat with optimistic new-chat rendering and durable threads.
- WorkOS-backed accounts, workspaces, memberships, roles, and agent selection.
- Searchable run history with cancellation, retry, reconnect, and approval recovery.
- Server-enforced tool visibility, execution modes, policy, and audit.

![Workbench history with a selected retryable run](docs/assets/readme/history-and-recovery.png)

### Agent Operations

- Code-first agent packs with behavior, tools, workflows, risk, and smoke metadata.
- Current-agent Tools separates user-run workflows, agent-only tools, and
  workflow-internal adapters.
- Typed read-only workflows with bounded inputs and inspectable artifacts.
- Signed external signals and callback-backed Fly/LangGraph execution.
- Sentry and first-party runtime traces across Vercel, Cloudflare, and Fly.

![Admin Agent Packs catalog](docs/assets/readme/workspace-and-policy.png)

## Why Assistant-mk1

Most agent starters optimize for the first chat response. Assistant-mk1 focuses
on what comes after that: who the agent acts for, which tools it can see, how
long-running work is controlled, where results live, and how an operator recovers
when execution fails or pauses for approval.

The base workbench stays domain-neutral. Product behavior belongs in agent packs,
workspace configuration, policy, tools, and integrations rather than hard-coded
application assumptions.

## Architecture

| Surface          | Responsibility                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------- |
| Vercel / Next.js | WorkOS browser session, workbench UI, and signed same-origin facades                         |
| Cloudflare       | Authorization, D1 control state, Durable Object chat, policy, audit, events, and normal chat |
| Fly / LangGraph  | Graph-shaped workflows and signed heavy tool execution                                       |

Trusted tenant scope is derived server-side. The browser never chooses trusted
`userId`, `workspaceId`, `agentId`, or provider credentials.

See [Architecture](docs/architecture.md), [Tenancy](docs/tenancy.md), and the
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

Agent packs are the code-first extension boundary. Each checked-in pack declares
behavior, tools, workflows, UI hints, risk posture, context, and smoke scenarios
without bypassing workspace policy or tenant authorization.

The bundled v1 examples are **Repository Analyst**, **Polymancer Research**, and
**Swordfish Runtime**. Each includes an immediate pack-specific welcome, a
bounded read-only workflow, and a structured artifact in History. Allowlisted
operators can reuse or instantiate the current pack version from Admin without
mutating older agent snapshots.

```bash
pnpm agent-packs:validate
pnpm agent-packs:inspect --pack repo-analyst
pnpm agent-packs:smoke --pack repo-analyst
```

The current contract supports local checked-in packs. See [Agent Packs](docs/agent-packs.md)
and [Agent Profile Authoring](docs/agent-profile-authoring.md).

## Verification

```bash
pnpm verify:fast   # packs, eval posture, unit tests, types, lint, format
pnpm verify        # fast gate plus production build
pnpm test:e2e      # signed-out and trusted-local browser journeys
pnpm release:check # complete repository and browser release gate
```

The browser suite uses isolated D1 state under `output/playwright/`. Runtime
changes should also run the affected Cloudflare or Fly smoke documented in
[Contributing](CONTRIBUTING.md).

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

Deploy Cloudflare and Fly before a Vercel release that depends on them:

- [Vercel](docs/deployment-vercel.md)
- [Cloudflare and local infrastructure](docs/dev-infrastructure-readiness.md)
- [Fly](docs/deployment-fly.md)

Remote D1 is currently disposable validation state. Forward-only migrations and
retention remain tracked in [Migrations and Retention](docs/migrations-and-retention.md).

## Contributing and Security

Read [CONTRIBUTING.md](CONTRIBUTING.md) before changing runtime boundaries.
Report vulnerabilities through [SECURITY.md](SECURITY.md), not a public issue.

This repository uses pnpm. Do not update the lockfile with npm or yarn.

## License

Assistant-mk1 is source-available under the
[PolyForm Noncommercial License 1.0.0](LICENSE). Noncommercial use is permitted
under those terms. Commercial use requires a separate written agreement; see
[Commercial Use](COMMERCIAL_USE.md).

This license is not an OSI-approved open-source license.

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=dawi369/assistant-mk1&type=Date)](https://www.star-history.com/#dawi369/assistant-mk1&Date)
