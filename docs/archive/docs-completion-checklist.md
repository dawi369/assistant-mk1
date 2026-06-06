# Docs Completion Checklist

Status: archived historical docs-readiness checklist.

This checklist captured the "90% docs complete" milestone before the first real
runtime slices. Active implementation should now be guided by
`docs/implementation-roadmap.md`, the current topology docs, and the operational
deployment runbooks.

This checklist defines what "90% docs complete" means before the main runtime
implementation starts.

Status values:

- `build-ready`: implementation should not need major product decisions.
- `active first slice`: implemented for the current Cloudflare-owned demo slice,
  not complete for the full product.
- `partial`: direction exists, but implementation would still invent details.
- `deferred`: intentionally postponed until a later implementation phase.

## Current Status

| Area                          | Status                      | Source                                                       |
| ----------------------------- | --------------------------- | ------------------------------------------------------------ |
| Product direction             | build-ready                 | `docs/agent-workbench.md`, `docs/implementation-roadmap.md`  |
| System architecture           | build-ready                 | `docs/architecture.md`                                       |
| Implementation roadmap        | build-ready                 | `docs/implementation-roadmap.md`                             |
| Runtime model                 | build-ready                 | `docs/runtime.md`, `docs/run-lifecycle.md`                   |
| Run lifecycle                 | build-ready                 | `docs/run-lifecycle.md`                                      |
| Tool system                   | build-ready                 | `docs/tool-system.md`                                        |
| Policy model                  | build-ready                 | `docs/policy-model.md`                                       |
| Context assembly              | build-ready                 | `docs/context-assembly.md`                                   |
| Durable entities              | build-ready                 | `docs/db-contracts.md`                                       |
| Data-client boundary          | build-ready                 | `docs/db-contracts.md`, `lib/agent-framework/data-client.ts` |
| Control-plane operations      | build-ready for first slice | `docs/control-plane-api.md`                                  |
| Workbench UI IA               | build-ready                 | `docs/workbench-ui.md`                                       |
| Observability and audit       | build-ready                 | `docs/observability-and-audit.md`                            |
| First vertical slice          | build-ready                 | `docs/first-vertical-slice.md`                               |
| Tenancy principles            | build-ready                 | `docs/tenancy.md`                                            |
| Secret/risk principles        | build-ready                 | `docs/secrets-and-risk.md`                                   |
| Fly staging                   | build-ready                 | `docs/deployment-fly.md`                                     |
| Vercel frontend               | active first slice          | `docs/deployment-vercel.md`                                  |
| Cloudflare target             | partial                     | `docs/cloudflare-control-plane.md`                           |
| Fly runtime gateway           | active first slice          | `docs/deployment-fly.md`, `docs/fly-tool-runners.md`         |
| Production auth provider      | deferred                    | future auth implementation plan                              |
| Secret storage implementation | deferred                    | future secret custody implementation                         |
| D1 Worker migrations          | active first slice          | `cloudflare/control-plane/migrations`                        |
| R2/DO migrations              | deferred                    | future artifact and coordination storage                     |
| Cloudflare deployment         | active first slice          | `docs/dev-infrastructure-readiness.md`                       |
| Live mutation tools           | deferred                    | blocked by production mutation gate                          |

## Required Before Main Implementation

- Docs index includes every canonical doc.
- Architecture topology Mermaid sources and diagram briefs are current.
- Provisional TypeScript contracts match durable/runtime docs.
- First vertical slice has clear acceptance criteria.
- assistant-ui leverage boundaries are documented.
- Current known lint/formatter drift is reported if full lint still fails.

`build-ready for first slice` means the first vertical slice should not need
major product decisions. Production auth, trigger operations, storage
implementation, and Cloudflare/Fly infrastructure details remain deferred until
their implementation phases.

## Definition Of 90%

The docs are 90% complete when an implementer can build the first vertical slice
without choosing:

- whether assistant-ui owns product state
- what a run record means
- how child runs behave
- how tools become model-visible
- how policy blocks mutation
- how context is assembled
- which data-client operation owns each durable record
- what the first UI surfaces need to show
- which safety gates block live mutation

The remaining 10% is expected to be discovered during implementation and should
feed back into docs as concrete behavior, not speculative architecture.
