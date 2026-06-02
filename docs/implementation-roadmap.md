# Implementation Roadmap

This roadmap turns the current assistant-ui LangGraph starter into the target
Assistant-MK1 workbench without hiding major architecture decisions inside the
first implementation pass.

The default rule is docs and contracts first, then the smallest working vertical
slice. Do not add persistence, Cloudflare resources, migrations, secret storage,
or live mutation tools until the slice that needs them is explicitly scoped.

## Current Baseline

- Next.js serves the assistant UI and API routes.
- assistant-ui owns the first chat surface, message rendering, composer,
  attachments, tool-call rendering primitives, and stream ergonomics.
- `@assistant-ui/react-langgraph` bridges the browser runtime to LangGraph
  threads and streams.
- `backend/agent.ts` is a minimal OpenRouter-backed LangGraph graph.
- `/api/[..._path]` proxies browser LangGraph SDK traffic.
- `/api/external-signals` is a token-protected staging ingress for starts,
  resumes, and cron creation.
- Provisional framework contracts define tenant scope, workflow intents,
  run records, tool exposure, durable entities, and repository-style data
  access.

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

## Phase 1: Build-Ready Docs

Goal: implementation can start without inventing runtime semantics mid-change.

Complete:

- Run lifecycle state machine.
- Tool system and policy model.
- Context assembly algorithm.
- Control-plane operation contracts.
- Workbench UI information architecture.
- Observability and audit rules.
- First vertical slice acceptance spec.

Exit criteria:

- `docs/docs-completion-checklist.md` marks core runtime/tool/control-plane/UI
  areas as build-ready or explicitly deferred.
- Provisional TypeScript contracts are synchronized with docs where needed.
- Architecture graph and README doc index are current.

## Phase 2: Local Mock Vertical Slice

Goal: prove the architecture without committing to production storage.

Implement a local in-memory or fixture-backed slice:

```txt
manual/external signal
  -> trusted tenant scope fixture
  -> WorkflowIntent
  -> RunRecord
  -> mock typed tool call
  -> lifecycle events
  -> audit/artifact/decision output
  -> workbench status surface
```

Use assistant-ui for the thread/composer/message path. Add workbench panels only
where the current assistant-ui surface does not represent run status, durable
outputs, or policy state.

Exit criteria:

- User can trigger the slice locally.
- UI shows run status and durable outputs.
- Tool output is structured, auditable, and redacted.
- No provider or tool secrets reach the browser.

## Phase 3: Tool Adapter Foundation

Goal: make tools boring to add.

Current local target: a runtime tool registry and exposure resolver path. The
first registered tool remains the deterministic `demo.inspect` dry-run tool;
the implementation should prove registration and visibility before adding real
CLI or mutation-capable tools.

Implement:

- Runtime tool registry.
- Tool exposure resolver.
- First native TypeScript demo tool.
- First CLI/OSS-backed demo tool with timeout, cancellation, logs, structured
  output, and artifact metadata.
- Policy checks for `ask`, `dry_run`, and `execute` modes.

Exit criteria:

- A new typed tool can be added without changing framework internals.
- Model-visible tool set is narrower than the installed tool registry.
- Tool calls produce `ToolCallRecord`, audit events, and artifacts.

## Phase 4: Durable Runtime Skeleton

Goal: replace mock state with a scoped data-client implementation.

Current target: Cloudflare-owned demo run control. The local or remote Worker
creates the run in D1, delegates deterministic execution to a signed
Next/Fly-style executor, receives progress/result callbacks, and serves the
completed snapshot from Cloudflare-owned state. The browser-visible workbench
button now uses this path by default.

Implement:

- Durable run records, workflow intents, tool calls, audit events, artifacts,
  managed state, ledgers, and decision records.
- Artifact storage path for logs and generated outputs.
- Restart and resume checks for interrupted work.

Exit criteria:

- State survives local restart where expected.
- Two dev tenants cannot read each other's state.
- Run status, history, and artifacts are inspectable.
- A local Cloudflare Worker can own a dev demo run while a signed executor
  performs the work and reports callbacks.

## Phase 5: Hosted Control Plane Split

Goal: move from local/staging wiring toward the target Cloudflare/Fly split.

Implement:

- Cloudflare-style control-plane ingress and scoped data APIs.
- Signed tool-runner calls to Fly.
- Progress callbacks or scoped status writes from Fly/LangGraph.
- Cloudflare-owned user-facing stream.
- Trigger and schedule handling through trusted tenant metadata.

Exit criteria:

- External trigger wakes the correct tenant/agent.
- Cloudflare mediates state access for Fly/LangGraph.
- Hosted smoke validates `/api/health`, assistant thread creation, streaming,
  external signal path, and the vertical slice.

## Phase 6: Production Gates

Goal: allow mutation-capable tools only after platform safety exists.

Required before live external mutation:

- Auth and workspace membership.
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
