# North-Star Production Architecture Diagram

Last updated: 2026-06-03

## Purpose

Show the finished production shape Assistant-MK1 is aiming at: a multi-user,
tenant-scoped agent workbench where Cloudflare owns live coordination and
canonical app-state mediation, Fly owns heavy execution, and all durable outputs
return to auditable state.

This is a north-star product graph, not the current implementation map. It should
make the target ownership boundaries clear enough that future implementation
plans can be checked against it.

## Detail Level

Subsystem-level, implementation-guiding, not file-by-file. Major boxes should
represent real product subsystems, runtime boundaries, policy gates, contracts,
state stores, or external mutation boundaries. The canvas should be explicit
enough for an implementing agent to reason about ownership and handoffs without
adding dense prose to the drawing.

## Scene Metadata

- Excalidraw collection: `assitant-mk1`
- Collection ID: `AKvvdxjb2JT`
- Scene name: `North-Star Production Architecture`
- Scene ID: `45QPwyuJsdP`
- Scene URL: `https://app.excalidraw.com/s/9kkAn7igiCf/45QPwyuJsdP`
- Canonical source: this brief
- Visual artifact: editable Excalidraw+ scene

## Source Evidence

- `docs/architecture.md`: target control plane, workflow execution plane, policy,
  and canonical state shape
- `docs/runtime.md`: conversational control plane, workflow plane, runs, child
  runs, interrupts, crons, external signals, and persistence
- `docs/cloudflare-control-plane.md`: Cloudflare ownership of live coordination,
  tenant scope, policy, mediated data APIs, D1/R2/DO state
- `docs/fly-tool-runners.md`: Fly as heavy execution plane and signed
  tenant-scoped tool boundary
- `docs/data-and-state.md`: durable entity ownership, D1/R2/workflow backend
  responsibilities, mediated data-client access pattern
- `docs/policy-model.md`: deterministic policy boundary, execution modes,
  approval gates, production mutation gate, and failure behavior
- `docs/db-contracts.md`: durable entity contracts and data-client boundary
- `docs/observability-and-audit.md`: lifecycle events, audit trail, artifacts,
  and health responsibilities

## Intended Diagram

Use five visibly separated regions:

- `Users/client`: Workbench UI, thread surface, run/status panels, approvals,
  and artifacts plus managed state.
- `Cloudflare control plane`: auth/session/trigger ingress, tenant scope
  derivation, agent hot state, intent router, tool exposure resolver,
  `PolicyDecision`, approval interrupt, run control, streaming gateway, and
  mediated data API.
- `Fly execution plane`: signed tool gateway, tool runners, CLI/OSS adapters,
  browser automation, LangGraph workflow workers, and progress callbacks.
- `External systems`: model providers, approved APIs/tools, schedules/webhooks,
  GitHub/Vercel/Railway/Supabase-like services, and mutation targets.
- `Durable canonical state`: D1 users/workspaces/tools/runs, D1
  audit/decisions/ledgers/triggers, R2 logs/reports/screenshots/exports, Durable
  Object hot per-agent state, and workflow backend in-flight checkpoints.

Typed arrow categories:

- `user interaction`: browser workbench sends chat, approval, status, and
  artifact requests to Cloudflare-owned surfaces.
- `trusted scope`: Cloudflare derives tenant scope from trusted auth, session,
  schedule, webhook, or tool-event context.
- `intent creation`: chat or external events become typed workflow intents only
  when complex work is needed.
- `policy decision`: policy gates tool exposure, execution mode, approvals,
  secret access, mutation limits, and kill switches.
- `approval interrupt`: policy can pause a run until user approval resumes,
  cancels, or fails it.
- `signed work`: Cloudflare sends tenant-scoped signed work to Fly execution.
- `external call`: Fly calls model providers, approved APIs, automation targets,
  and mutation targets only after policy approval.
- `progress callback`: Fly reports status and final summaries back to
  Cloudflare, not directly to the browser as source of truth.
- `canonical write`: Cloudflare-mediated data-client writes run records, audit
  events, decisions, ledgers, managed state, tool calls, and artifacts.
- `stream update`: Cloudflare streams progress, approval state, status, and
  final results to the user/client.

## Visual Rules

- Draw this as production target only; do not mix current starter/Fly-staging
  shortcuts into this diagram.
- Make Cloudflare the visual center of ownership.
- Make Fly clearly execution-only, not the user-facing stream owner.
- Show tenant scope and policy before execution.
- Show durable state as the place final truth lands.
- Keep labels short and use brief text for detail.
- Use routed elbow arrows; do not run connectors through unrelated boxes.
- Use callout badges for invariants: tenant scope is derived, model never
  supplies scope, Cloudflare owns canonical writes, and Fly executes only.

## Acceptance Checklist

- The scene exists in collection `AKvvdxjb2JT`.
- The scene is separate from the current architecture overview scene.
- Cloudflare, Fly, durable state, browser/workbench, and external systems are
  visually distinct.
- Tenant scope and policy appear before any execution path.
- Heavy execution goes through signed Fly services.
- Final durable outputs return to auditable canonical state.
- Every arrow maps to one typed arrow category listed in this brief.
- Scene metadata in this file includes the final scene ID and URL.
