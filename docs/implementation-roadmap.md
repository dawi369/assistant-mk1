# Implementation Roadmap

This roadmap keeps implementation sequencing visible without preserving every
completed slice as live planning text. Current implementation truth still comes
from the code and the current-runbook docs listed in `docs/README.md`.

Default rule: docs and contracts first, then the smallest working vertical
slice. Do not add persistence, Cloudflare resources, migrations, secret
storage, or live mutation tools until the slice that needs them is explicitly
scoped.

## Current Baseline

- Vercel hosts the Next.js workbench and same-origin browser API facades.
- WorkOS AuthKit is the hosted web-session boundary. Vercel derives trusted
  user/account identity and forwards it to Cloudflare.
- Cloudflare owns app authorization, D1-backed user/workspace/membership/agent
  state, active workspace and agent preferences, normal chat session
  coordination, runtime summaries, Admin visibility, tool policy, and
  control-plane events.
- Normal chat uses assistant-ui's AI SDK runtime and Cloudflare Agents. The
  browser connects to a per-thread `WorkbenchThreadChatAgent`; Durable Object
  SQLite owns hot message state and D1 mirrors compact run/thread/trace state
  for Admin.
- `WorkbenchSessionAgent` owns hot session snapshots, recent thread summaries,
  active-thread switching, signed per-thread Agent connection payloads, and the
  scoped live-session event stream.
- New chat starts as a local blank session. D1/Cloudflare thread state is
  created on first send through the materialize-turn path, then the browser
  reconnects to the normal per-thread Agent runtime.
- Fly/LangGraph remain available for graph-shaped workflows, the runtime
  gateway, and signed heavy tool execution. They are not the default path for a
  plain chat message.
- The diagnostic `demo.inspect` path remains compatibility coverage for the
  original Cloudflare-owned run slice. It is not a product pattern.
- Read-only tools now include `url.inspect` and `repo.snapshot`, with
  Cloudflare-owned tool policy, runner metadata, artifacts, audit events,
  runtime traces, and model exposure controls.
- Code-first local agent packs can be checked into `agent-packs/*`, surfaced as
  behavior templates, and snapshotted into workspace-scoped agent records.
- `/agents` is the main pack/workflow surface, `/run` is a shortcut into the
  same panel, and active Polymancer/Swordfish pack workflows use shared
  lifecycle helpers for workflow intents, runs, tool calls, artifact metadata,
  audit, and events.
- `/history` is a normal workbench surface for scoped execution history,
  selected-run summaries, and metadata-only artifacts. Admin still carries
  deeper diagnostics.
- Admin-only conformance tools now cover Cloudflare-inline ping,
  callback-backed Fly runner echo, and metadata artifact creation. They are
  model-hidden, dry-run-only, and non-policy-editable.
- Vercel external signals now enter Cloudflare first. Cloudflare creates typed
  workflow intent, run, audit, and control-plane event records before
  delegating to LangGraph where needed.
- Generic signed workflow callbacks are implemented at
  `POST /workbench/run-callbacks` for delegated work to report compact
  lifecycle/artifact metadata back into Cloudflare-owned D1 state.
- Admin can read recent execution history, artifact metadata, selected run
  snapshots, compact/drawer summary projections, and recovered-vs-current error
  state through Cloudflare-owned APIs.
- The current dev schema is rebuildable. Keep the active schema in
  `cloudflare/control-plane/schema.sql` until the project explicitly introduces
  migrations and remote data retention. The migration/retention gate is now
  tracked in `docs/migrations-and-retention.md`.
- The repo now has a GitHub Actions verification gate for clean installs,
  agent-pack validation, focused workflow/tool-policy tests, typecheck, lint,
  and build.

## Active Next Targets

1. Keep reducing perceived latency in the chat shell: cached workspace/thread
   chrome, immediate draft input, fast thread switching, first-send
   materialization, and background reconciliation with Cloudflare-owned truth.
2. Keep model-visible tools narrow and policy-gated; harden model-side tool
   rendering and approval explanations before broader model tool use.
3. Expand read-only adapters beyond `url.inspect` and `repo.snapshot` only
   where they prove the common runner, policy, artifact, and audit model.
4. Expand code-first agent packs from behavior snapshots into more workflow
   bindings, tool-specific configuration, context assembly, smoke scenarios,
   and package verification.
5. Keep promoting execution history and artifact metadata from read-only
   metadata into richer product surfaces: previews, filters, export/delete
   behavior, and artifact blob storage when retention gates exist.
6. Add swappable domain context configuration for downstream apps, developer
   installs, and business integrations without introducing a committed
   `Project` entity.
7. Move more Fly/LangGraph producers onto scoped callbacks and session-event
   fanout instead of one-off status paths.
8. Define the developer/customer packaging story: setup, capability toggles,
   sample integrations, safe defaults, and upgrade boundaries.

## Production Gates

Mutation-capable tools stay blocked until the platform has:

- A non-destructive D1 migration path and retention policy for any table or
  artifact class the tool needs to preserve.
- WorkOS-backed customer/workspace administration beyond the current pre-user
  defaults.
- Cloudflare-owned membership and tool authorization for customer-facing roles.
- Encrypted secret custody.
- Tenant isolation tests for every durable state boundary touched by the tool.
- Policy limits, approvals, cooldowns, allowlists, denylists, and kill switches.
- Immutable audit events and ledger entries for proposed, simulated, executed,
  skipped, blocked, and reviewed actions.
- Redaction across logs, traces, artifacts, provider payloads, and
  model-visible content.

Live trading, deploy mutation, database mutation, billing, email sending, and
production admin actions remain blocked until these gates exist.

## Deferred Until Proven Needed

- Universal model-provider abstraction.
- Arbitrary user-installed filesystem hooks.
- Direct D1/R2 access from Fly/LangGraph.
- Production multi-region topology.
- Full plugin marketplace or profile system.
- Compression and session lineage beyond the context assembly contract.
- A separate committed user-visible `Project` entity.

## Completed Foundation

The repo has already completed the major foundation slices needed for the next
tool and workbench work:

- Build-ready architecture docs, provisional contracts, and topology diagrams.
- Cloudflare-owned diagnostic run persistence with tenant isolation coverage.
- WorkOS/Vercel to Cloudflare identity resolution with fail-closed hosted auth
  behavior.
- Workspace management, membership source of truth, agent routing, and agent
  behavior snapshots.
- Local code-first agent pack v0 with `repo-analyst` as the first pack-backed
  behavior template.
- Cloudflare Agents normal-chat runtime, session coordinator, recent threads,
  runtime summaries, live events, and traces.
- Admin visibility, tool registry exposure, Admin conformance tools,
  `url.inspect`, durable tool policy, approval lifecycle, and runner metadata.
- `repo.snapshot` as the first serious read-only CLI/OSS adapter behind the
  shared policy/run/artifact/audit/trace model.
- Cloudflare-first external-signal intent mirroring before LangGraph
  delegation.
- Generic signed workflow callback ingestion with demo compatibility migrated
  onto the shared callback path.
- Admin execution history, artifact metadata history, and selected-run
  snapshots.
- Runtime visibility trimming, Admin summary projection tiers, and a
  responsive local-new/pre-runtime draft shell.
