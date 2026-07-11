# Docs Map

This folder separates current runbooks, target contracts, reference-app
pressure, and architectural decisions. Check a document's section below before
treating it as current implementation truth.

There is no separate goal doc. The north star is a reusable workbench product:
personal enough for my own agent operations, packaged enough for developers to
run or buy, and configurable enough for willing businesses to integrate without
forking the core runtime.

- Product direction: `agent-workbench.md`
- Capability and autonomy contract: `capability-model.md`
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
- `agent-profile-authoring.md`: behavior template authoring format and
  snapshot contract.
- `agent-packs.md`: code-first local agent pack contract and current example.
- `implementation-roadmap.md`: current baseline, active next targets,
  production gates, and deferred work.
- `migrations-and-retention.md`: current D1 reset boundary and the retained
  data migration/retention gate.
- `workbench-ui.md`: current UI baseline and target workbench surfaces.
- `dev-infrastructure-readiness.md`: local/remote setup, smoke commands, and
  resource checklist.
- `evals.md`: real-session eval posture, manifest, and verifier command.
- `release-readiness.md`: 1.0 read-only baseline, deferred gates, and release evidence.
- `level-2-conformance.md`: executable Level 0-2 guarantees and release evidence mapping.
- `deployment-vercel.md` and `deployment-fly.md`: deployment runbooks.
- `diagrams/current-implementation-topology.mmd`: current topology source.

## Target Contracts

These files are intentionally ahead of implementation. They define north-star
contracts and constraints; any implementation still needs to land behind the
Cloudflare authorization boundary in `tenancy.md`.

- `capability-model.md`
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
- `reference-apps/swordfish.md`
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
- `decisions/ADR-0008-selective-eve-pattern-adoption.md`

ADR-0008 is the accepted source for Eve-inspired pattern adoption. There is no
separate Eve reference doc.
