# Assistant-MK1 Architecture Overview Diagram

Last updated: 2026-06-03

## Purpose

Show the current hosted implementation topology of Assistant-MK1 after replacing
the old graph-as-code diagram pipeline. This diagram is an overview only: it
should help a maintainer see the active Vercel frontend, Cloudflare Worker
control-plane slice, Fly LangGraph/runtime executor, and durable data boundary
without recreating every detailed architecture view.

## Detail Level

Subsystem-level, implementation-guiding, not file-by-file. Major boxes should
represent real runtime seams, contracts, policy gates, storage responsibilities,
or trust boundaries. The canvas should be explicit enough for an implementing
agent to update adjacent docs or code without needing the old graph generator.

## Diagram Source

- Mermaid source: `docs/diagrams/current-implementation-topology.mmd`
- Canonical visual source: the Mermaid file
- Evidence source: this brief
- Visual artifact: paste the Mermaid source into Excalidraw's Mermaid import

## Source Evidence

- `docs/architecture.md`: system shape, control plane shape, seams, runtime
  boundaries, deployment boundary
- `docs/infrastructure.md`: infrastructure topology and request flow
- `docs/cloudflare-control-plane.md`: target live multi-user coordination plane
- `docs/fly-tool-runners.md`: target heavy tool and workflow execution plane
- `docs/data-and-state.md`: storage responsibilities and durable outputs
- `docs/db-contracts.md`: data-client boundary and durable entity contracts
- `docs/runtime.md`: LangGraph threads, runs, interrupts, crons, and external
  signals
- `app/assistant.tsx`: frontend assistant-ui runtime integration seam
- `app/api/[..._path]/route.ts`: Next.js proxy to LangGraph API
- `app/api/external-signals/route.ts`: token-protected external-signal ingress
- `app/api/workbench/cloudflare-demo-runs/route.ts`: Vercel workbench facade to
  the Cloudflare control-plane Worker
- `cloudflare/control-plane/src/index.ts`: Worker routing for demo runs and run
  callbacks
- `scripts/langgraph-runtime-gateway.ts`: Fly runtime gateway, LangGraph proxy,
  and signed demo executor endpoint
- `backend/agent.ts`: current LangGraph backend/provider seam
- `langgraph.json`: graph id mapping for local and hosted LangGraph execution

## Intended Diagram

Use four visibly separated pillars plus one sidecar cluster:

- `Vercel / Frontend`: Next.js app, assistant-ui thread, `/api` LangGraph
  facade, `external-signals` API, and workbench API routes.
- `Cloudflare / Worker Control Plane`: control-plane Worker, trusted dev
  identity, demo run APIs, and run callback endpoint.
- `Fly.io / LangGraph Execution`: runtime gateway, LangGraph server,
  `backend/agent.ts`, and signed demo executor.
- `Durable Data Plane`: current D1 demo/control records plus planned R2,
  Durable Object, and workflow checkpoint responsibilities.
- `External sidecars`: external triggers and OpenRouter provider. Keep this as
  one sidecar cluster, not a fifth pillar.

Typed arrow categories:

- `chat request`: assistant-ui traffic flows through the Vercel `/api` facade to
  the Fly LangGraph gateway.
- `trusted ingress`: external signals enter through the Vercel API route before
  calling the server-side runtime.
- `workbench action`: Vercel workbench routes call the Cloudflare Worker with
  trusted dev identity headers.
- `signed dispatch`: Cloudflare dispatches demo work to the signed Fly executor.
- `progress callback`: Fly executor reports run events back to the Cloudflare
  callback endpoint.
- `canonical write`: Cloudflare writes current run, tool, artifact, decision,
  and audit data to D1.
- `planned storage`: R2, Durable Object hot state, and workflow checkpoints are
  shown as planned responsibilities, not current durable implementation.

## Visual Rules

- Draw current hosted implementation only; put north-star production topology in
  `docs/diagrams/north-star-implementation-topology.mmd`.
- Use exactly four primary pillars: Vercel/frontend, Cloudflare/Worker, Fly.io
  LangGraph execution, and durable data.
- Keep external providers and triggers in one sidecar cluster.
- Keep text short enough to read when zoomed out.
- Use concrete repo/runtime names.
- Keep source/evidence detail in this brief, not as dense canvas text.
- Keep Mermaid node labels short enough to survive Excalidraw import.
- Do not add generated Markdown, generated HTML, or a TypeScript graph pipeline.
- Route storage writes into the data pillar.
- Do not draw any Fly-to-browser source-of-truth path.

## Acceptance Checklist

- The Mermaid source exists at `docs/diagrams/current-implementation-topology.mmd`.
- The source contains one high-level topology, not seven detailed views.
- The source has exactly four primary pillars and no more than one sidecar
  cluster.
- Vercel/frontend, Cloudflare/Worker, Fly.io LangGraph execution, and durable
  data are visually separated.
- All required systems listed in this brief appear in the Mermaid topology.
- Directional relationships are represented by typed Mermaid edges.
- Every arrow maps to one typed arrow category listed in this brief.
- Cloudflare remains the current canonical owner for demo run state.
- Data writes route into the durable data pillar.
- The Mermaid source can be pasted into Excalidraw for a manual editable
  rendering.
