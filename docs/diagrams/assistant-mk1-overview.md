# Assistant-MK1 Architecture Overview Diagram

Last updated: 2026-06-03

## Purpose

Show the durable system-level shape of Assistant-MK1 after replacing the old
graph-as-code diagram pipeline. This diagram is an overview only: it should help
a maintainer see the current browser/runtime path, the current execution path,
and the target workbench control/execution/storage split without recreating
every detailed architecture view.

## Detail Level

Subsystem-level, implementation-guiding, not file-by-file. Major boxes should
represent real runtime seams, contracts, policy gates, storage responsibilities,
or trust boundaries. The canvas should be explicit enough for an implementing
agent to update adjacent docs or code without needing the old graph generator.

## Scene Metadata

- Excalidraw collection: `assitant-mk1`
- Collection ID: `AKvvdxjb2JT`
- Scene name: `Assistant-MK1 Architecture Overview`
- Scene ID: `4T59psgkJDe`
- Scene URL: `https://app.excalidraw.com/s/9kkAn7igiCf/4T59psgkJDe`
- Canonical source: this brief
- Visual artifact: editable Excalidraw+ scene

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
- `backend/agent.ts`: current LangGraph backend/provider seam
- `langgraph.json`: graph id mapping for local and hosted LangGraph execution

## Intended Diagram

Use three visibly separated regions plus a storage row:

- `Current browser path`: `app/assistant.tsx`, assistant-ui runtime,
  `lib/chatApi.ts`, Next.js `/api` proxy, and `external-signals` route.
- `Current execution path`: Fly staging container, `backend/agent.ts`,
  LangGraph Agent Server, and OpenRouter provider.
- `Target workbench path`: Cloudflare Agent/control plane, trusted tenant
  scope, intent router, `PolicyDecision`, `RunRecord`, tool exposure resolver,
  signed Fly dispatch, LangGraph workflow service, data-client contract, and
  `LifecycleEvent -> audit`.
- `Storage responsibilities`: D1 tenant/control records, R2 artifacts, Durable
  Object hot coordination, and workflow backend checkpoints.

Typed arrow categories:

- `request`: browser/runtime requests through assistant-ui, chat API, and
  Next.js proxy.
- `trusted ingress`: external signals enter through the token-protected route,
  then derive scope server-side.
- `current execution`: current proxy and external-signal requests reach
  LangGraph, which invokes OpenRouter server-side.
- `target control`: Cloudflare derives trusted tenant scope, creates typed
  workflow intent, applies policy, and creates/updates run control.
- `tool exposure`: policy/runtime narrows registered tools before model-visible
  or execution-visible use.
- `signed dispatch`: Cloudflare dispatches approved work to Fly and escalates
  complex workflows to LangGraph workflow service.
- `durable write`: execution results return through data-client into D1, R2,
  Durable Object state, workflow checkpoints, and audit events.
- `stream update`: progress and final results return to the browser through
  Cloudflare-owned stream/status surfaces in the target architecture.

## Visual Rules

- Keep current implementation and target/planned architecture visually distinct.
- Keep text short enough to read when zoomed out.
- Use concrete repo/runtime names.
- Keep source/evidence detail in this brief, not as dense canvas text.
- Use editable shapes with labels and bound arrows.
- Use routed elbow arrows; do not run connectors through unrelated boxes.
- Use callout badges for invariants: tenant scope is derived, model never
  supplies scope, Cloudflare owns canonical writes, and Fly executes only.

## Acceptance Checklist

- The scene exists in collection `AKvvdxjb2JT`.
- The scene contains one high-level overview, not seven detailed views.
- Current and target/planned regions are visually separated.
- All required systems listed in this brief appear on the canvas.
- Directional relationships are represented by editable, bound arrows.
- Every arrow maps to one typed arrow category listed in this brief.
- Scene metadata in this file includes the final scene ID and URL.
