# Assistant-mk1 Architecture Overview Diagram

Last updated: 2026-06-11

## Purpose

Show the current hosted implementation topology of assistant-mk1 after WorkOS,
Cloudflare Agent chat, workspace/agent routing, and control-plane event
visibility landed. This diagram is an overview only: it should help a
maintainer see the active Vercel frontend, Cloudflare Worker control-plane
slice, Fly LangGraph/runtime executor, and durable data boundary without
recreating every detailed architecture view.

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
- `docs/dev-infrastructure-readiness.md`: current hosted WorkOS, Cloudflare D1,
  Vercel, and Fly runtime baseline
- `docs/data-and-state.md`: storage responsibilities and durable outputs
- `docs/db-contracts.md`: data-client boundary and durable entity contracts
- `docs/runtime.md`: LangGraph threads, runs, interrupts, crons, and external
  signals
- `lib/workbench/agent-identity.ts`: WorkOS/local-dev identity derivation and
  trusted headers sent from Vercel to Cloudflare
- `app/assistant.tsx`: frontend assistant-ui runtime integration seam
- `app/api/workbench/chat-session/*`: Vercel facades that ask Cloudflare for
  the active chat session, recent threads, and Cloudflare-signed Agent token
- `app/api/[..._path]/route.ts`: legacy/transition Next.js proxy to LangGraph
  API for workflow escalation paths
- `app/api/external-signals/route.ts`: token-protected external-signal ingress
- `app/api/workbench/cloudflare-demo-runs/route.ts`: Vercel workbench facade to
  the Cloudflare control-plane Worker
- `app/api/workbench/*`: Vercel same-origin facades for workspace, agent, admin
  summary, chat runtime summary, demo run, and control-plane event routes
- `cloudflare/control-plane/src/index.ts`: Worker routing for WorkOS-shaped
  identity, workspace/agent APIs, chat facade, control events, demo runs, and
  run callbacks
- `cloudflare/control-plane/src/authz.ts`: D1-backed user, workspace,
  membership, active workspace, and active agent resolution
- `cloudflare/control-plane/src/chat-agent-connection-context.ts`: Worker
  helper that creates/resolves the active D1 thread for Agent chat
- `cloudflare/control-plane/src/chat-session.ts`: Worker session API that owns
  active thread selection, workspace history, and Agent token minting
- `cloudflare/control-plane/src/thread-chat-agent.ts`: Cloudflare
  `AIChatAgent` Durable Object chat runtime
- `cloudflare/control-plane/src/langgraph-facade.ts`: legacy Worker
  `/langgraph` compatibility facade and Fly fallback/proxy path
- `cloudflare/control-plane/schema.sql`: current D1 tables for users,
  workspaces, memberships, agents, active preferences, chat state, control
  events, runtime traces, demo runs, artifacts, decisions, and audit records
- `scripts/langgraph-runtime-gateway.ts`: Fly runtime gateway, LangGraph proxy,
  and signed demo executor endpoint
- `backend/agent.ts`: current LangGraph backend/provider seam
- `langgraph.json`: graph id mapping for local and hosted LangGraph execution

## Intended Diagram

Use four visibly separated pillars plus one sidecar cluster:

- `Vercel / Frontend`: Next.js app, WorkOS AuthKit session, assistant-ui
  thread, Agent connection route, `external-signals` API, and workbench API
  routes.
- `Cloudflare / Worker Control Plane`: control-plane Worker, WorkOS scope
  resolver, workspace and agent authorization, Agent thread context,
  `AIChatAgent` Durable Object, workspace/agent/admin APIs, event feed/runtime
  summary, demo run APIs, and run callback endpoint.
- `Fly.io / LangGraph Execution`: runtime gateway, LangGraph server,
  `backend/agent.ts`, and signed demo executor.
- `Durable Data Plane`: current D1 user/workspace/agent records, D1 chat state,
  D1 run/event/artifact records, Durable Object SQLite chat messages, plus
  planned R2 and workflow checkpoint responsibilities.
- `External sidecars`: external triggers and OpenRouter provider. Keep this as
  one sidecar cluster, not a fifth pillar.

Typed arrow categories:

- `agent connection`: assistant-ui asks Vercel for a server-derived Agent
  connection; Vercel calls Cloudflare, then returns a short-lived token.
- `WebSocket chat`: assistant-ui talks directly to the Cloudflare `AIChatAgent`
  Durable Object for normal messages.
- `fallback/escalation proxy`: unsupported LangGraph-compatible endpoints and
  future heavy workflow escalation can still go through the Fly LangGraph
  gateway.
- `trusted ingress`: external signals enter through the Vercel API route and
  currently use the staging LangGraph SDK path.
- `workbench action`: Vercel workbench routes call the Cloudflare Worker with
  WorkOS-derived or local-dev trusted headers.
- `scope resolution`: Cloudflare resolves user, account, active workspace,
  membership, and active agent from trusted headers and D1.
- `signed dispatch`: Cloudflare dispatches demo work to the signed Fly executor.
- `progress callback`: Fly executor reports run events back to the Cloudflare
  callback endpoint.
- `canonical write`: Cloudflare writes user/workspace/agent, chat, run, tool,
  event, artifact, decision, and audit data to D1.
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
- Cloudflare remains the current canonical owner for workspace, agent, chat,
  event, and demo run state.
- Data writes route into the durable data pillar.
- The Mermaid source can be pasted into Excalidraw for a manual editable
  rendering.
