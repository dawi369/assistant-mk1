# Implementation Roadmap

This roadmap turns the current assistant-ui LangGraph starter into the target
Assistant-MK1 workbench without hiding major architecture decisions inside the
first implementation pass.

The default rule is docs and contracts first, then the smallest working vertical
slice. Do not add persistence, Cloudflare resources, migrations, secret storage,
or live mutation tools until the slice that needs them is explicitly scoped.

## Current Baseline

- Vercel hosts the Next.js assistant UI and browser-facing API facade.
- assistant-ui owns the first chat surface, message rendering, composer,
  attachments, tool-call rendering primitives, and stream ergonomics.
- `@assistant-ui/react-langgraph` bridges the browser runtime to LangGraph
  threads and streams through the Fly LangGraph runtime gateway.
- `backend/agent.ts` is a minimal OpenRouter-backed LangGraph graph.
- `/api/[..._path]` proxies browser LangGraph SDK traffic.
- `/api/external-signals` is a token-protected staging ingress for starts,
  resumes, and cron creation.
- WorkOS AuthKit is configured on Vercel as the hosted sign-in boundary.
  Vercel maps WorkOS `user.id` and, when present, WorkOS `organizationId` into
  trusted tenant scope before calling Cloudflare. Organization-backed
  workspaces are the north-star B2B shape; the current personal workspace
  fallback keeps solo/pre-user development production-shaped.
- Provisional framework contracts define tenant scope, workflow intents,
  run records, tool exposure, durable entities, and repository-style data
  access.
- Cloudflare owns the current workbench demo run path, including trusted dev
  tenant scope, D1-backed run snapshots, callbacks, and tenant-isolation smoke
  coverage.
- Cloudflare fronts hosted LangGraph-compatible chat traffic, stores
  tenant-scoped chat sessions, thread ownership, chat intents, policy
  decisions, minimal chat run envelopes, and control-plane activity events.
  The workbench can subscribe to those activity events through a browser-safe
  Vercel facade.
- Fly runs the dedicated LangGraph runtime gateway and signed `demo.inspect`
  executor endpoint.

## Assistant-UI Principle

Leverage assistant-ui before inventing local UI/runtime primitives.

Use directly:

- Thread and message primitives.
- Composer behavior.
- Attachment affordances.
- Tool-call rendering where the stream shape fits.
- Interrupt and stream primitives where they map cleanly.

Wrap:

- Runtime creation and loading.
- Interrupt presentation and resume actions.
- Tool-call inspection and artifact display.
- Thread/run status surfaces around the chat.

Own separately:

- Tenant scope.
- Secret custody.
- Policy and execution modes.
- Durable run control.
- Ledgers and managed state.
- Decision records and provenance.
- External triggers and schedules.
- Cloudflare/Fly orchestration.

Low-level `components/assistant-ui/*` should stay reusable and mostly
product-agnostic. Workbench-specific panels should compose around the thread.

## Phase 1: Completed Build-Ready Docs

Goal: implementation can start without inventing runtime semantics mid-change.

Completed baseline:

- Run lifecycle state machine.
- Tool system and policy model.
- Context assembly algorithm.
- Control-plane operation contracts.
- Workbench UI information architecture.
- Observability and audit rules.
- Provisional TypeScript contracts are synchronized with docs where needed.
- Architecture topology Mermaid sources, diagram briefs, and README doc index
  are current.

## Phase 2: Completed Cloudflare-Owned Demo Slice

Goal: prove the architecture with the smallest safe production-shaped run path.

Implemented baseline:

```txt
browser workbench action
  -> Vercel workbench facade
  -> trusted dev tenant scope
  -> Cloudflare Worker
  -> D1-backed WorkflowIntent
  -> D1-backed RunRecord
  -> signed Fly executor
  -> demo.inspect tool
  -> Worker callbacks
  -> audit/artifact/decision output
  -> workbench status surface
```

Local Cloudflare development still uses the Next executor route for convenience.
Hosted dev uses the dedicated Fly runtime executor.

Exit criteria met:

- User can trigger the slice from the hosted UI.
- UI shows run status and durable outputs.
- Tool output is structured, auditable, and redacted.
- Two trusted dev tenants cannot read each other's latest run.
- No provider or tool secrets reach the browser.

## Phase 3: Tool Adapter Foundation

Goal: make tools boring to add.

Current baseline: a runtime tool registry and exposure resolver path exist for
the deterministic `demo.inspect` dry-run tool. The next useful increment is a
second read-only tool adapter that proves timeout, cancellation, logs,
structured output, and artifact metadata without adding mutation capability.

Implemented:

- Runtime tool registry.
- Tool exposure resolver.
- First native TypeScript demo tool.
- Tool call records, audit events, decision summaries, and artifact metadata
  for the Cloudflare-owned demo path.

Next target:

- First CLI/OSS-backed demo tool with timeout, cancellation, logs, structured
  output, and artifact metadata.
- Policy checks for `ask`, `dry_run`, and `execute` modes at the tool-runner
  boundary.

Exit criteria:

- A new typed tool can be added without changing framework internals.
- Model-visible tool set is narrower than the installed tool registry.
- Tool calls produce durable output records through Cloudflare-owned state.

## Phase 4: Durable Data-Client Expansion

Goal: expand from demo-run persistence into scoped repository groups.

Current baseline:

```txt
Vercel workbench facade
  -> Cloudflare Worker
  -> WorkflowIntent
  -> RunRecord
  -> ToolCallRecord
  -> audit/artifact/decision output
  -> scoped snapshot reads
```

Next target:

- Add one real data-client repository group beyond the demo snapshot path.
- Prefer workspace context, decisions, audit events, or artifact metadata before
  R2/DO provisioning.
- Keep Fly/LangGraph state access mediated through Cloudflare APIs.
- Add read-only admin visibility for the resolved user, workspace, membership,
  active agent, recent control-plane events, and last runtime error.

Exit criteria:

- Two dev tenants cannot read each other's state.
- Repository operations enforce trusted tenant scope.
- Hosted smoke proves the repository group through the Vercel -> Cloudflare ->
  Fly path when execution is involved.

## Phase 5: Cloudflare-Owned Conversational Control Plane

Goal: move user-facing conversation and workflow progress behind Cloudflare.

Current baseline: workbench run control is Cloudflare-owned, and assistant-ui
chat now flows through the Cloudflare `/langgraph` facade. Cloudflare owns
tenant-scoped session/thread ownership, chat intents, policy decisions, minimal
run envelopes, a tenant-scoped control-plane event feed, and a short-lived SSE
stream for browser-visible runtime activity. Fly/LangGraph still own graph
execution and the facade remains LangGraph-compatible.

Next target:

- Cloudflare-style control-plane ingress and scoped data APIs.
- Cloudflare-owned user-facing stream for conversation and workflow progress,
  building on the event feed as the first observable state source.
- Progress callbacks or scoped status writes from Fly/LangGraph into canonical
  state.
- Trigger and schedule handling through trusted tenant metadata.
- Expand WorkOS-backed identity beyond the first D1 membership/default-agent
  slice: richer roles, explicit workspace administration, tool authorization,
  and trigger-owned tenant metadata, without moving tenant enforcement back into
  the browser.

Exit criteria:

- External trigger wakes the correct tenant/agent.
- Cloudflare mediates state access for Fly/LangGraph.
- Hosted smoke validates `/api/health`, assistant thread creation, streaming,
  external signal path, and the Cloudflare-owned workbench path.

## Phase 6: Production Gates

Goal: allow mutation-capable tools only after platform safety exists.

Required before live external mutation:

- Auth and workspace membership. WorkOS AuthKit sign-in and the first
  Cloudflare D1-backed membership/default-agent resolver exist, but production
  role policy, explicit admin flows, and tool authorization are still required.
- Encrypted secret custody.
- Tenant isolation tests.
- Policy limits, approvals, cooldowns, allowlists, denylists, and kill switches.
- Immutable audit events.
- Ledger entries for proposed, simulated, executed, skipped, blocked, and
  reviewed actions.
- Redaction across logs, traces, artifacts, and model-visible content.

Live trading, deploy mutation, database mutation, billing, email sending, and
production admin actions stay blocked until these gates exist.

## Deferred Until Proven Needed

- Universal model-provider abstraction.
- Arbitrary user-installed filesystem hooks.
- Direct D1/R2 access from Fly/LangGraph.
- Production multi-region topology.
- Full plugin marketplace or profile system.
- Compression and session lineage beyond the context assembly contract.
