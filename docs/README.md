# Docs Map

This folder mixes current runbooks, target contracts, reference-app pressure,
and historical notes. Check document status before treating any file as current
implementation truth.

There is no separate goal doc:

- Product direction: `agent-workbench.md`
- Implementation sequencing: `implementation-roadmap.md`
- Reference-app pressure: `reference-apps/*`
- Topology diagram workflow: `diagrams/README.md`

## Current Implementation

These files should stay aligned with code changes:

- `architecture.md`: current system shape, seams, and hosted boundary.
- `infrastructure.md`: active Vercel, Cloudflare, Fly, and LangGraph split.
- `tenancy.md`: WorkOS account, workspace, membership, and agent authorization.
- `cloudflare-control-plane.md`: Worker/D1 responsibilities, Cloudflare Agents
  chat, Admin/tool routes, and transitional LangGraph facade.
- `agent-workbench.md`: product scope, Admin direction, and component rules.
- `implementation-roadmap.md`: current baseline, active next targets,
  production gates, and deferred work.
- `workbench-ui.md`: current UI baseline and target workbench surfaces.
- `dev-infrastructure-readiness.md`: local/remote setup, smoke commands, and
  resource checklist.
- `deployment-vercel.md` and `deployment-fly.md`: deployment runbooks.
- `diagrams/current-implementation-topology.mmd`: current topology source.

## Target Contracts

These files are intentionally ahead of implementation. They define north-star
contracts and constraints; any implementation still needs to land behind the
Cloudflare authorization boundary in `tenancy.md`.

- `db-contracts.md`
- `control-plane-api.md`
- `data-and-state.md`
- `run-lifecycle.md`
- `runtime.md`
- `tool-system.md`
- `policy-model.md`
- `context-assembly.md`
- `context-engineering.md`
- `observability-and-audit.md`
- `secrets-and-risk.md`
- `fly-tool-runners.md`
- `diagrams/north-star-production-architecture.md`
- `diagrams/north-star-implementation-topology.mmd`

## Reference Apps

Reference app docs are stress tests for the framework, not product identity:

- `reference-apps/polymancer.md`
- `reference-apps/deployment-agent.md`
- `reference-apps/personal-job-agent.md`
- `decisions/ADR-0002-polymancer-reference-target.md`

They should not introduce committed core entities unless the base architecture
adopts those entities explicitly. There is still no committed `Project` entity.

## Decisions

Decision records capture durable choices and direction:

- `decisions/ADR-0001-local-first-fly-staging.md`
- `decisions/ADR-0002-polymancer-reference-target.md`
- `decisions/ADR-0003-conversation-workflow-control-plane.md`
- `decisions/ADR-0004-cloudflare-control-plane-fly-tool-runners.md`
- `decisions/ADR-0005-cloudflare-langgraph-facade.md`
- `decisions/ADR-0006-cloudflare-owned-model-routing.md`
- `decisions/ADR-0007-cloudflare-agents-live-chat-runtime.md`

## Archive

`archive/` contains historical planning docs. Do not use archive content as
current implementation status without checking the live docs and code first.
