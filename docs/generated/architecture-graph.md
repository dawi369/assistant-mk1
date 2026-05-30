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

## Generated Views

Open the HTML explorer for rendered diagrams, searchable catalogs, filters, and clickable references.

- Whole-System Overview: 14 nodes, 12 edges.
- Current Repo Map: 20 nodes, 14 edges.
- Target Runtime Map: 11 nodes, 11 edges.
- Data And State Map: 12 nodes, 10 edges.
- Workflow Lifecycle Map: 10 nodes, 9 edges.
- Tool Execution Map: 8 nodes, 7 edges.
- Tenancy And Security Map: 9 nodes, 8 edges.

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
