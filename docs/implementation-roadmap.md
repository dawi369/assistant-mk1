# Implementation Roadmap

This roadmap turns the current assistant-ui LangGraph starter into the target
assistant-mk1 workbench without hiding major architecture decisions inside the
first implementation pass.

The default rule is docs and contracts first, then the smallest working vertical
slice. Do not add persistence, Cloudflare resources, migrations, secret storage,
or live mutation tools until the slice that needs them is explicitly scoped.

## Current Baseline

- Vercel hosts the Next.js assistant UI and browser-facing API facade.
- assistant-ui owns the first chat surface, message rendering, composer,
  attachments, tool-call rendering primitives, and stream ergonomics.
- `@assistant-ui/react-langgraph` bridges the browser runtime to a
  LangGraph-shaped thread and stream contract.
- `backend/agent.ts` is a minimal OpenRouter-backed LangGraph graph.
- `/api/[..._path]` proxies browser LangGraph SDK traffic.
- `/api/external-signals` is a token-protected staging ingress for starts,
  resumes, and cron creation.
- WorkOS AuthKit is configured on Vercel as the hosted sign-in boundary.
  Vercel maps WorkOS `user.id` and, when present, WorkOS `organizationId` into
  trusted user/account identity before calling Cloudflare. Organization-backed
  accounts get one default workspace first and can now create additional
  Dev Monitor-managed workspaces; the current personal account/default
  workspace fallback keeps solo/pre-user development production-shaped.
- Provisional framework contracts define tenant scope, workflow intents,
  run records, tool exposure, durable entities, and repository-style data
  access.
- Cloudflare owns the current workbench demo run path, including trusted dev
  tenant scope, D1-backed run snapshots, callbacks, and tenant-isolation smoke
  coverage.
- Cloudflare fronts hosted LangGraph-compatible chat traffic, stores
  tenant-scoped chat sessions, thread ownership, lightweight transcript
  continuity, chat intents, policy decisions, chat run envelopes, and
  control-plane activity events. Normal simple chat is answered from
  Cloudflare, not Fly.
  The workbench can subscribe to those activity events through a browser-safe
  Vercel facade.
- Fly runs the dedicated LangGraph runtime gateway and signed `demo.inspect`
  executor endpoint. It is the heavy workflow/tool execution plane, not the
  normal simple-chat path.

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
  -> D1-backed user/account/workspace/membership/agent authz
  -> active workspace and active agent preferences
  -> WorkflowIntent
  -> RunRecord
  -> ToolCallRecord
  -> audit/artifact/decision output
  -> scoped snapshot reads
```

Implemented:

- Dev Monitor v1 as the first read-only admin visibility slice:
  Cloudflare `GET /admin/workspace-summary`, Vercel
  `GET /api/workbench/admin-summary`, and a flow-first drawer that shows chat
  readiness, active workspace/agent, latest events, and important errors before
  secondary management controls and advanced raw details.
- Chat polish checkpoint v0: the normal shell has a compact server-derived
  runtime hint for active workspace, active agent/profile, chat state, and
  error-detail access while keeping assistant-ui as the primary chat surface.
- Thread history v0 is the active chat-polish slice: assistant-ui's native
  remote thread-list runtime and thread-list primitives show recent
  Cloudflare-owned chats for the resolved user/workspace/active agent, while
  Cloudflare D1 remains the source of truth for thread ownership and the
  active thread.
- Chat runtime responsiveness and observability v0 is the current stabilization
  slice: the compact hint uses assistant-ui local lifecycle state for immediate
  transient `Running` feedback, idle admin-summary polling is removed, and
  Cloudflare simple-chat run metadata records timing marks for first-token,
  provider, pre-stream, and total runtime inspection.
- Workspace management v0 as the first Cloudflare-owned workspace model
  slice: D1 active workspace preference, Cloudflare `GET /workspaces`,
  `POST /workspaces`, `POST /workspaces/:workspaceId/activate`, Vercel
  facades, and Dev Monitor-only list/create/switch controls.
- Membership source-of-truth v0: WorkOS role/permission headers can seed
  missing memberships, but Cloudflare D1 membership role/status/permissions are
  authoritative after bootstrap. Active members can read context; `owner` and
  `admin` gate workspace writes.
- Agent routing v0: agents stay workspace-scoped, Cloudflare stores
  active-agent preferences per user/workspace, and Dev Monitor can create and
  activate test agents for the current workspace.
- Agent behavior v0: new agents can import XML behavior templates into
  `agents.data_json.behavior`; Cloudflare injects the D1 snapshot into simple
  chat, and Dev Monitor previews the active behavior.

Next target:

- Stabilize template-backed behavior in hosted chat, then expand it into full
  editing, version history, approvals, and tool-specific behavior controls.
- Keep Fly/LangGraph state access mediated through Cloudflare APIs.
- Strengthen the Vercel-to-Cloudflare trust boundary with a stricter signed or
  service-authenticated server contract after this observability slice.

Exit criteria:

- Two dev tenants cannot read each other's state.
- Repository operations enforce trusted tenant scope.
- Hosted smoke proves the repository group through the Vercel -> Cloudflare ->
  Fly path when execution is involved.

## Phase 5: Cloudflare-Owned Conversational Control Plane

Goal: move user-facing conversation and workflow progress behind Cloudflare.

Current baseline: workbench run control is Cloudflare-owned, and assistant-ui
chat now flows through the Cloudflare `/langgraph` compatibility facade.
Cloudflare owns normal simple chat, tenant-scoped session/thread ownership,
lightweight transcript continuity, chat intents, policy decisions, run
envelopes, a tenant-scoped control-plane event feed, and a short-lived SSE
stream for browser-visible runtime activity. Fly/LangGraph still own complex
workflow execution and explicit heavy escalation.

Small chat request flow is intentionally production-shaped but still
LangGraph-compatible for assistant-ui: browser assistant-ui runtime -> Vercel
`/api` proxy -> Cloudflare `/langgraph` facade -> Cloudflare simple chat ->
OpenRouter. Fly/LangGraph should not handle normal small messages; an
`upstreamRunId` on a normal chat run means the request escalated or regressed
away from the intended path.

Next target:

- Cloudflare timing metadata on simple-chat runs, surfaced through existing
  runtime summaries and Dev Monitor, so latency can be explained by stage
  rather than guessed from browser perception.
- Broaden the Cloudflare-owned stream from simple chat into richer conversation
  and workflow progress, building on the event feed as the first observable
  state source.
- Progress callbacks or scoped status writes from Fly/LangGraph into canonical
  state.
- Trigger and schedule handling through trusted tenant metadata.
- Expand WorkOS-backed identity beyond the first D1 membership and agent
  routing slices: customer-facing workspace administration, tool
  authorization, trigger-owned tenant metadata, and clearer organization UX
  without moving tenant enforcement back into the browser.
- Sequence the workspace/authz product work as admin visibility, workspace
  management, membership source of truth, agent routing, agent behavior,
  broader Cloudflare ownership, stronger Vercel-to-Cloudflare trust, and WorkOS
  organization UX.

Exit criteria:

- External trigger wakes the correct tenant/agent.
- Cloudflare mediates state access for Fly/LangGraph.
- Hosted smoke validates `/api/health`, assistant thread creation, streaming,
  external signal path, and the Cloudflare-owned workbench path.

## Phase 6: Production Gates

Goal: allow mutation-capable tools only after platform safety exists.

Required before live external mutation:

- Auth and workspace membership. WorkOS AuthKit sign-in, Cloudflare D1-backed
  membership policy, workspace management v0, agent routing v0, and agent
  behavior v0 exist, but explicit customer admin flows, invites, behavior
  approvals, and tool authorization are still required.
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
