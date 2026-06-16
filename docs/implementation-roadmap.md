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
- Fly/LangGraph remain available for graph-shaped workflows, the runtime
  gateway, and signed heavy tool execution. They are not the default path for a
  plain chat message.
- The diagnostic `demo.inspect` path remains as compatibility coverage for the
  original Cloudflare-owned run slice. The first real read-only adapter is
  `url.inspect`, with Cloudflare-owned tool policy, approvals, runner metadata,
  artifacts, audit events, and runtime traces.
- The current dev schema is rebuildable. Keep the active schema in
  `cloudflare/control-plane/schema.sql` until the project explicitly introduces
  migrations and remote data retention.

## Active Next Targets

1. Stabilize normal chat and Admin runtime visibility on top of the trace graph,
   live-session events, and recent-thread switching.
2. Keep model-visible tools narrow and policy-gated; harden model-side tool
   rendering and approval explanations before broader model tool use.
3. Add the first read-only CLI/OSS-backed tool on the runner boundary, with
   timeout, logs, structured output, artifact metadata, and no secret custody.
4. Expand agent behavior from template import/preview into editing, version
   history, approvals, and tool-specific configuration.
5. Add artifact list and execution history surfaces beyond diagnostic snapshots.
6. Add swappable domain context configuration for downstream apps without
   introducing a committed `Project` entity.
7. Broaden Cloudflare-owned workflow progress by having Fly/LangGraph publish
   scoped callbacks into D1 and the `WorkbenchSessionAgent`.

## Production Gates

Mutation-capable tools stay blocked until the platform has:

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
- Cloudflare Agents normal-chat runtime, session coordinator, recent threads,
  runtime summaries, live events, and traces.
- Admin visibility, tool registry exposure, `url.inspect`, durable tool policy,
  approval lifecycle, and runner metadata.
