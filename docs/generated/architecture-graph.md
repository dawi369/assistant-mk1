<!-- GENERATED FILE: do not edit directly. Run `pnpm graph:render`. -->

# Assistant-MK1 Internal Architecture Graph

Developer-facing map of the current assistant-ui LangGraph starter and the target reusable agent workbench architecture.

> Canonical source: `docs/architecture.graph.ts`. The HTML explorer is the primary visual output.

> Preferred visual explorer: [`docs/generated/architecture-graph/index.html`](architecture-graph/index.html).

## Summary

- Nodes: 53
- Edges: 74
- Views: 7

## Graph Maintenance

Update `docs/architecture.graph.ts` and then run `pnpm graph:render` whenever a change affects architecture shape, runtime boundaries, durable contracts, generated graph tooling, or any tracked source path listed below.

Review the graph when a change does any of the following:

- Adds, removes, renames, or materially changes a tracked source file.
- Changes a runtime boundary, API route, provider seam, deployment shape, or generated graph tooling.
- Changes framework/data-client contracts, durable entity definitions, tool execution, tenancy, policy, storage, or secret-custody assumptions.
- Promotes a `target` or `planned` concept into current implementation.

## Mega View

The HTML explorer includes a collapsed Mega View generated from every canonical node and edge. Use scoped views for understanding; use the Mega View for completeness checks.

- Nodes: 53
- Edges: 74
- Node kind groups:
  - api_route: 3
  - app: 2
  - component: 6
  - config: 1
  - doc: 2
  - entity: 9
  - external: 2
  - interface: 5
  - policy: 4
  - runtime: 7
  - storage: 4
  - tooling: 2
  - workflow: 6

## Generated Views

Open the HTML explorer for rendered diagrams, searchable catalogs, filters, and clickable references.

- Whole-System Overview: 14 nodes, 12 edges.
- Current Repo Map: 20 nodes, 14 edges.
- Target Runtime Map: 11 nodes, 11 edges.
- Data And State Map: 12 nodes, 10 edges.
- Workflow Lifecycle Map: 10 nodes, 9 edges.
- Tool Execution Map: 8 nodes, 7 edges.
- Tenancy And Security Map: 9 nodes, 8 edges.

## View Details

Each view stays compact here and expands in the HTML explorer. The TypeScript graph remains the source of truth.

<details>
<summary>Whole-System Overview: 14 nodes, 12 edges</summary>

Current frontend/backend plus target control plane, execution plane, and storage.

Nodes: `assistant-mk1`, `next-app`, `home-route`, `assistant-runtime`, `cloudflare-control-plane`, `fly-tool-runners`, `langgraph-workflow-service`, `data-client-contract`, `durable-entity-contracts`, `artifact-metadata`, `d1-storage`, `r2-storage`, `durable-object-state`, `workflow-backend-state`.

Edges: `assistant-mk1-uses-next-app`, `home-renders-assistant`, `cloudflare-owns-stream`, `cloudflare-calls-fly`, `cloudflare-calls-langgraph-workflows`, `cloudflare-owns-data-client`, `fly-uses-data-client`, `langgraph-service-uses-data-client`, `d1-stores-entities`, `r2-stores-artifacts`, `durable-object-stores-hot-state`, `workflow-backend-stores-checkpoints`.

</details>

<details>
<summary>Current Repo Map: 20 nodes, 14 edges</summary>

Checked-in app routes, backend graph, components, contracts, and config.

Nodes: `next-app`, `home-route`, `assistant-runtime`, `thread-ui`, `attachment-ui`, `markdown-ui`, `reasoning-ui`, `tool-call-ui`, `ui-primitives`, `chat-client`, `api-proxy`, `external-signals-route`, `health-route`, `langgraph-backend`, `openrouter-provider`, `langgraph-config`, `framework-contracts`, `durable-entity-contracts`, `data-client-contract`, `assistant-mk1`.

Edges: `next-renders-home`, `home-renders-assistant`, `assistant-renders-thread`, `thread-renders-attachments`, `thread-renders-markdown`, `thread-renders-reasoning`, `thread-renders-tool-calls`, `assistant-uses-chat-client`, `chat-client-calls-api-proxy`, `api-proxy-proxies-langgraph`, `external-signals-calls-langgraph`, `langgraph-config-configures-backend`, `langgraph-backend-calls-openrouter`, `frontend-must-not-access-provider`.

</details>

<details>
<summary>Target Runtime Map: 11 nodes, 11 edges</summary>

Cloudflare owns coordination and streams; Fly/LangGraph execute heavy workflows.

Nodes: `assistant-runtime`, `cloudflare-control-plane`, `tenant-scope`, `policy-layer`, `workflow-intent`, `signed-tool-call`, `fly-tool-runners`, `langgraph-workflow-service`, `data-client-contract`, `audit-event`, `artifact-metadata`.

Edges: `cloudflare-owns-stream`, `cloudflare-derives-scope`, `cloudflare-enforces-policy`, `cloudflare-creates-intents`, `cloudflare-calls-fly`, `cloudflare-calls-langgraph-workflows`, `signed-tool-call-targets-fly`, `fly-uses-data-client`, `langgraph-service-uses-data-client`, `tool-execution-writes-audit`, `tool-execution-writes-artifact`.

</details>

<details>
<summary>Data And State Map: 12 nodes, 10 edges</summary>

Repository operations mapped to durable entities and backing storage responsibilities.

Nodes: `data-client-contract`, `tenant-scope`, `durable-entity-contracts`, `decision-record`, `audit-event`, `artifact-metadata`, `workflow-intent`, `tool-call-record`, `managed-state`, `ledger-entry`, `d1-storage`, `r2-storage`.

Edges: `data-client-enforces-scope`, `data-client-writes-decisions`, `data-client-writes-audit`, `data-client-writes-artifacts`, `data-client-writes-intents`, `data-client-writes-tool-calls`, `data-client-writes-managed-state`, `data-client-writes-ledger`, `d1-stores-entities`, `r2-stores-artifacts`.

</details>

<details>
<summary>Workflow Lifecycle Map: 10 nodes, 9 edges</summary>

Generic observe/analyze/propose/execute/review flow and durable outputs.

Nodes: `workflow-lifecycle`, `observe-stage`, `analyze-stage`, `propose-stage`, `execute-stage`, `review-stage`, `decision-record`, `audit-event`, `ledger-entry`, `managed-state`.

Edges: `workflow-starts-observe`, `observe-to-analyze`, `analyze-to-propose`, `propose-to-execute`, `execute-to-review`, `review-writes-decisions`, `review-writes-audit`, `review-writes-ledger`, `review-writes-managed-state`.

</details>

<details>
<summary>Tool Execution Map: 8 nodes, 7 edges</summary>

Policy-gated tool request, Fly execution, and audit/artifact persistence.

Nodes: `cloudflare-control-plane`, `policy-layer`, `execution-policy`, `signed-tool-call`, `fly-tool-runners`, `tool-call-record`, `artifact-metadata`, `audit-event`.

Edges: `cloudflare-enforces-policy`, `policy-enforces-execution-policy`, `cloudflare-calls-fly`, `signed-tool-call-targets-fly`, `tool-execution-writes-tool-call`, `tool-execution-writes-artifact`, `tool-execution-writes-audit`.

</details>

<details>
<summary>Tenancy And Security Map: 9 nodes, 8 edges</summary>

Scope derivation, policy enforcement, secret custody, and browser boundaries.

Nodes: `assistant-runtime`, `external-trigger`, `cloudflare-control-plane`, `tenant-scope`, `data-client-contract`, `policy-layer`, `execution-policy`, `secret-custody`, `openrouter-provider`.

Edges: `trigger-uses-scope`, `cloudflare-derives-scope`, `data-client-enforces-scope`, `cloudflare-enforces-policy`, `policy-enforces-execution-policy`, `policy-enforces-secret-custody`, `secret-custody-must-not-browser`, `frontend-must-not-access-provider`.

</details>

## Node Groups

- api_route: 3 (`api-proxy`, `external-signals-route`, `health-route`)
- app: 2 (`assistant-mk1`, `home-route`)
- component: 6 (`thread-ui`, `attachment-ui`, `markdown-ui`, `reasoning-ui`, `tool-call-ui`, `ui-primitives`)
- config: 1 (`langgraph-config`)
- doc: 2 (`docs-architecture`, `reference-apps`)
- entity: 9 (`decision-record`, `audit-event`, `artifact-metadata`, `workflow-intent`, `tool-call-record`, `managed-state`, `ledger-entry`, `trigger-record`, `tool-metadata`)
- external: 2 (`openrouter-provider`, `external-trigger`)
- interface: 5 (`chat-client`, `framework-contracts`, `durable-entity-contracts`, `data-client-contract`, `signed-tool-call`)
- policy: 4 (`policy-layer`, `secret-custody`, `tenant-scope`, `execution-policy`)
- runtime: 7 (`next-app`, `assistant-runtime`, `langgraph-backend`, `fly-staging`, `cloudflare-control-plane`, `fly-tool-runners`, `langgraph-workflow-service`)
- storage: 4 (`d1-storage`, `r2-storage`, `durable-object-state`, `workflow-backend-state`)
- tooling: 2 (`package-scripts`, `architecture-graph-tooling`)
- workflow: 6 (`workflow-lifecycle`, `observe-stage`, `analyze-stage`, `propose-stage`, `execute-stage`, `review-stage`)

## Edge Groups

- calls: 11
- configures: 1
- derives_scope: 2
- documents: 16
- emits: 5
- enforces: 4
- must_not_access: 2
- owns: 5
- proxies_to: 1
- renders: 7
- stores: 4
- streams_to: 1
- writes: 15

## Tracked Source Files

Changes to these source/config files should trigger a graph review if they alter responsibilities, boundaries, or contracts.

- `.env.example` -> openrouter-provider
- `app/api/[..._path]/route.ts` -> api-proxy
- `app/api/external-signals/route.ts` -> external-signals-route, external-trigger
- `app/api/health/route.ts` -> health-route
- `app/assistant.tsx` -> assistant-runtime
- `app/layout.tsx` -> next-app
- `app/page.tsx` -> next-app, home-route
- `backend/agent.ts` -> langgraph-backend, openrouter-provider
- `components/assistant-ui/attachment.tsx` -> attachment-ui
- `components/assistant-ui/markdown-text.tsx` -> markdown-ui
- `components/assistant-ui/reasoning.tsx` -> reasoning-ui
- `components/assistant-ui/thread.tsx` -> thread-ui
- `components/assistant-ui/tool-fallback.tsx` -> tool-call-ui
- `components/assistant-ui/tool-group.tsx` -> tool-call-ui
- `components/ui/avatar.tsx` -> ui-primitives
- `components/ui/button.tsx` -> ui-primitives
- `components/ui/collapsible.tsx` -> ui-primitives
- `components/ui/dialog.tsx` -> ui-primitives
- `components/ui/tooltip.tsx` -> ui-primitives
- `Dockerfile` -> fly-staging
- `docs/architecture.graph.ts` -> architecture-graph-tooling
- `fly.toml` -> fly-staging
- `goal.md` -> assistant-mk1
- `langgraph.json` -> langgraph-backend, langgraph-config
- `lib/agent-framework/contracts.ts` -> framework-contracts, policy-layer, tenant-scope, execution-policy
- `lib/agent-framework/data-client.ts` -> data-client-contract
- `lib/agent-framework/db-contracts.ts` -> durable-entity-contracts, decision-record, audit-event, artifact-metadata, workflow-intent, tool-call-record, managed-state, ledger-entry, trigger-record, tool-metadata
- `lib/chatApi.ts` -> chat-client
- `lib/utils.ts` -> ui-primitives
- `next.config.ts` -> next-app
- `package.json` -> package-scripts
- `pnpm-lock.yaml` -> package-scripts
- `README.md` -> assistant-mk1
- `scripts/render-architecture-graph.ts` -> architecture-graph-tooling

## Full Catalogs

The full node catalog, edge catalog, and file reference table are intentionally kept out of this Markdown file because they are too wide to render well here.
Use the HTML explorer for those details: [`docs/generated/architecture-graph/index.html`](architecture-graph/index.html).
