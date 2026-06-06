# Docs Map

This folder contains both current implementation docs and target architecture
docs. Read status before treating a document as a runbook.

There is no separate goal doc. Product direction lives in `agent-workbench.md`,
implementation sequencing lives in `implementation-roadmap.md`, and downstream
app pressure lives in `reference-apps/*`.

## Current Implementation

These docs describe what the repo does now and should stay tightly aligned with
code changes:

- `architecture.md`: current system shape, important seams, and hosted boundary.
- `infrastructure.md`: current Vercel, Cloudflare, Fly, and LangGraph split
  alongside the target flow.
- `tenancy.md`: current WorkOS account, workspace, membership, and agent
  authorization model.
- `cloudflare-control-plane.md`: current Worker/D1 responsibilities and the
  transitional LangGraph facade.
- `agent-workbench.md`: current product scope model and Dev Monitor direction.
- `implementation-roadmap.md`: baseline, completed slices, active next targets,
  and production gates.
- `workbench-ui.md`: current UI baseline and target workbench surfaces.
- `dev-infrastructure-readiness.md`: local/remote dev setup and smoke commands.
- `deployment-vercel.md` and `deployment-fly.md`: deployment runbooks.

## Target Architecture

These docs define contracts or north-star behavior. They are intentionally ahead
of the current implementation:

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

When these docs mention future APIs or storage, implementation still needs to
land behind the Cloudflare authorization boundary described in `tenancy.md`.

## Reference Apps

Reference app docs are stress tests for the framework, not product identity:

- `reference-apps/polymancer.md`
- `reference-apps/deployment-agent.md`
- `reference-apps/personal-job-agent.md`
- `decisions/ADR-0002-polymancer-reference-target.md`

They should not introduce committed core entities unless the base architecture
adopts those entities explicitly. There is still no committed `Project` entity.

## Decision Records

Decision records capture durable architecture choices and direction:

- `decisions/ADR-0001-local-first-fly-staging.md`
- `decisions/ADR-0002-polymancer-reference-target.md`
- `decisions/ADR-0003-conversation-workflow-control-plane.md`
- `decisions/ADR-0004-cloudflare-control-plane-fly-tool-runners.md`
- `decisions/ADR-0005-cloudflare-langgraph-facade.md`
- `decisions/ADR-0006-cloudflare-owned-model-routing.md`

## Architecture Diagrams

Mermaid files under `diagrams/` are the source of truth for topology diagrams.
Use `diagrams/README.md` for the update workflow.

## Archive

`archive/` contains historical planning docs. Do not use archive content as
current implementation status without checking the live docs and code first.
