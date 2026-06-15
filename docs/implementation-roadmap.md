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
- `@assistant-ui/react-ai-sdk` plus Cloudflare Agents now bridge the browser
  runtime to one `AIChatAgent` Durable Object per active thread for normal
  chat. The older LangGraph-shaped bridge remains available for workflow
  transition paths, not normal hosted messages.
- `backend/agent.ts` is a minimal OpenRouter-backed LangGraph graph.
- `/api/[..._path]` proxies browser LangGraph SDK traffic.
- `/api/external-signals` is a token-protected staging ingress for starts,
  resumes, and cron creation.
- WorkOS AuthKit is configured on Vercel as the hosted sign-in boundary.
  Vercel maps WorkOS `user.id` and, when present, WorkOS `organizationId` into
  trusted user/account identity before calling Cloudflare. Organization-backed
  accounts get one default workspace first and can now create additional
  Admin-managed workspaces; the current personal account/default
  workspace fallback keeps solo/pre-user development production-shaped.
- Provisional framework contracts define tenant scope, workflow intents,
  run records, tool exposure, durable entities, and repository-style data
  access.
- Cloudflare owns the current workbench demo run path, including trusted dev
  tenant scope, D1-backed run snapshots, callbacks, and tenant-isolation smoke
  coverage.
- Cloudflare owns hosted normal chat through `WorkbenchThreadChatAgent`
  Durable Objects, stores tenant-scoped chat sessions, thread ownership, chat
  intents, policy decisions, chat run envelopes, runtime traces, and
  control-plane activity events. Normal chat is answered from Cloudflare
  Agents, not Fly.
  The workbench can subscribe to those activity events through a browser-safe
  Vercel facade.
- Fly runs the dedicated LangGraph runtime gateway and signed `demo.inspect`
  executor endpoint. It is the heavy workflow/tool execution plane, not the
  normal chat path.

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
the deterministic `demo.inspect` dry-run tool and the Admin-triggered
`url.inspect` read-only adapter. `url.inspect` proves bounded tool execution,
structured output, artifact metadata, and Cloudflare-owned run/tool records
without adding mutation capability. Tool Policy v0 adds D1-backed
`tool_permissions` and `control_policy_decisions` so tool enablement, Admin
visibility, and execution blocks are durable instead of hard-coded. Policy
Expansion v0.1 adds approval-required and kill-switch state, durable
`control_approval_requests`, interrupted run records for approval-required safe
requests, and deterministic model-exposure explanations. Approval resume/deny
and model-visible `url.inspect` are implemented for the read-only path: owner
and admin users can explicitly expose `url.inspect` to the model, and exposure
stays blocked when approval is required.

Implemented:

- Runtime tool registry.
- Tool exposure resolver.
- First native TypeScript demo tool.
- Tool call records, audit events, decision summaries, and artifact metadata
  for the Cloudflare-owned demo path.
- Read-only `url.inspect` Admin tool with timeout, private-host blocking,
  structured report artifact, and D1-backed workflow/run/tool-call/audit/event
  records.
- Tool Policy v0 for Admin tools: default permission rows for `url.inspect` and
  `demo.inspect`, owner/admin enable-disable controls for `url.inspect`,
  policy-derived tool visibility, and auditable allow/block decisions.
- Policy Expansion v0.1 for Admin tools: approval-required state, kill-switch
  reason display, approval-request records, interrupted run/audit/event writes,
  and explicit model-exposure hidden reasons.
- Approval lifecycle completion for `url.inspect`: requested approvals can be
  approved to execute the original validated dry-run request or denied to
  cancel without a tool call/artifact; Admin shows a scoped approval queue and
  `approval.updated` events trigger live refresh.
- Policy-gated model exposure for the read-only `url.inspect` adapter:
  `modelVisible` defaults false, owner/admin users can opt in per current
  user/workspace/agent permission row, and approval-required or disabled policy
  states keep model exposure blocked.

Next target:

- Broader policy checks for `ask`, `dry_run`, and `execute` modes at the
  tool-runner boundary, including limits before any mutation-capable adapter.
- First CLI/OSS-backed or external-system adapter after the read-only policy,
  approval, and model-exposure path is proven in hosted dev.

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

- Admin v1 as the first read-only admin visibility slice:
  Cloudflare `GET /admin/workspace-summary`, Vercel
  `GET /api/workbench/admin-summary`, and a flow-first panel opened by the
  local `/admin` composer command. The command is gated by server-derived
  WorkOS/local identity and never reaches the model.
- Chat polish checkpoint v0: the normal shell has a compact server-derived
  runtime hint for active workspace, active agent/profile, chat state, and
  error-detail access while keeping assistant-ui as the primary chat surface.
  New chat is available as a local `/new` composer command.
- Thread history v0 proved recent Cloudflare-owned chat listing on the old
  LangGraph-shaped runtime. It is temporarily minimized during the Cloudflare
  Agents migration and should return after the direct Agent runtime is stable.
- Chat runtime responsiveness and observability v0 is implemented: the compact
  hint uses assistant-ui local lifecycle state for immediate transient
  `Running` feedback, idle admin-summary polling is removed, and Cloudflare
  chat run metadata records timing marks for first-token, provider, pre-stream,
  and total runtime inspection.
- Workspace management v0 as the first Cloudflare-owned workspace model
  slice: D1 active workspace preference, Cloudflare `GET /workspaces`,
  `POST /workspaces`, `POST /workspaces/:workspaceId/activate`, Vercel
  facades, and Admin-only list/create/switch controls.
- Membership source-of-truth v0: WorkOS role/permission headers can seed
  missing memberships, but Cloudflare D1 membership role/status/permissions are
  authoritative after bootstrap. Active members can read context; `owner` and
  `admin` gate workspace writes.
- Agent routing v0: agents stay workspace-scoped, Cloudflare stores
  active-agent preferences per user/workspace, and Admin can create and
  activate test agents for the current workspace.
- Agent behavior v0: new agents can import XML behavior templates into
  `agents.data_json.behavior`; Cloudflare injects the D1 snapshot into Agent
  chat, and Admin previews the active behavior.
- Read-only tool adapter and Admin visibility v0 is implemented:
  Cloudflare exposes a code-backed tool registry summary, Admin can run the
  bounded `url.inspect` dry-run tool, and D1 records the resulting
  workflow intent, run, tool call, artifact, audit events, and control-plane
  events. Tool Policy v0 makes `url.inspect` enablement durable and
  Admin-visible. Approval hardening adds scoped approve/deny and an Admin
  approval queue, while model exposure is explicitly gated and read-only.
- Runtime trace graph and Admin redesign v0 is implemented:
  Cloudflare stores D1-backed runtime traces and spans for thread creation,
  Agent chat streams, legacy simple-chat streams, and Admin tool runs. Admin
  now leads with a live service map and waterfall so request path and
  bottlenecks are visible before raw ids, events, or management controls.
- Thread Chat Agent v0 is the active chat-runtime slice: Vercel forwards
  WorkOS/local identity to Cloudflare, Cloudflare owns the active chat session
  and signed Agent token, and the browser connects to `WorkbenchThreadChatAgent`.
  Durable Object SQLite owns hot per-thread message state; D1 owns workspace
  history, active thread/agent selection, and compact run/trace metadata for
  Admin.
- Cloudflare Session Coordinator v0 is the active stabilization slice:
  a user/workspace `WorkbenchSessionAgent` Durable Object owns hot session
  snapshots, active-thread switching, recent thread summaries, and signed
  per-thread Agent connection payloads. D1 remains canonical, but normal
  `/new`, thread switching, and token refresh no longer require every UI
  component to reload the full session/history surface independently.
- Cloudflare Agents runtime lock-in v0 is implemented: the session layer
  refreshes scoped tokens through Cloudflare, each message gets its own trace,
  Agent runtime config is cached per Durable Object instance, and the message
  critical path blocks only on one minimal D1 run-start batch before OpenRouter
  starts.
- Chat UX Cache + Minimal Session Transitions v0 is the active stabilization
  slice: the browser caches display-safe recent-chat/session shell metadata,
  `/new` and thread activation return minimal active connection payloads first,
  full history refreshes in the background, and the app should not blank during
  normal thread transitions.
- Cloudflare Live Session Events v0 is the active stabilization slice:
  `WorkbenchSessionAgent` exposes a scoped SSE stream for session snapshots,
  thread create/switch/refresh, Agent chat run lifecycle, Admin tool updates,
  trace updates, and Admin summary invalidation. The browser uses this stream
  for sidebar/runtime/Admin freshness instead of broad polling, while D1 and
  Durable Object state remain canonical.

Next target:

- Use the trace graph and approval queue to stabilize the real chat/tool paths
  before adding mutation-capable tools or model-side approval UI.
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
normal chat now flows through Cloudflare Agents. Cloudflare owns normal chat,
tenant-scoped session/thread ownership, Durable Object hot message state, chat
intents, policy decisions, run envelopes, a tenant-scoped control-plane event
feed, runtime traces, and browser-visible Admin/runtime summaries.
Fly/LangGraph still own complex workflow execution and explicit heavy
escalation.

Small chat request flow is intentionally production-shaped: browser
assistant-ui runtime -> Vercel `/api/workbench/chat-session` -> Cloudflare
active workspace/thread/agent resolution and short-lived Agent token ->
Cloudflare `AIChatAgent` Durable Object -> OpenRouter. Fly/LangGraph should
not handle normal small messages; an `upstreamRunId` on a normal chat run means
the request escalated or regressed away from the intended path.

Next target:

- Stabilize Cloudflare-owned chat sessions with truthful first-token traces and
  comfortable workspace-level recent-thread switching on top of the Agent
  runtime.
- Broaden the Cloudflare-owned stream from normal Agent chat into richer
  workflow progress, building on the event feed and trace graph as observable
  state sources.
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
  approvals, tool authorization, and model-visible tool policy are still
  required.
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
