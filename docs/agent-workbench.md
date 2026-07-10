# Agent Workbench

The workbench is the reusable product layer this repo is meant to become. Chat
remains the first interface, but the product should support long-running agent
work, tools, external triggers, user knowledge, managed state, audit trails,
and multi-user isolation.

The target audience is broader than internal use:

- personal/operator use for my own agent workflows
- developer use, where another dev can define agents in code, run, configure,
  extend, and eventually buy the workbench as a serious OSS/commercial tool
- business integration use, where a willing company gets scoped agents inside
  its workflows, permissions, data, approvals, and audit boundaries

Document status: the shipped surface is assistant-ui chat plus local workbench
commands for `/new`, `/agents`, active-agent slash actions, `/history`, and
server-gated `/admin`. The broader surfaces below are direction, not a claim
that every UI exists today.

## Product Scope

The committed tenant model is workspace plus agent. A separate user-visible
project concept is not part of the current architecture. Product-specific
workbench composition can still show app/domain context, environment, docs,
repo assumptions, or app state.

Reference apps such as Polymancer, deployment agents, and the Personal Job
Agent are benchmark pressure tests. Real customer integrations should follow
the same rule: validate autonomy, secrets, ledgers, browser automation,
external signals, and policy without baking a single domain into the base
workbench.

## Core Surfaces

- Thread state: idle, running, interrupted, blocked, or failed.
- Run control: start, stop, retry, enqueue, inspect, and resume work.
- Interrupts and approvals: missing input, blocked tools, approval prompts, and
  external resume points.
- Tools: registry, visibility, permissions, policy, recent calls, failures, and
  model-exposure explanations.
- Artifacts and history: files, logs, screenshots, reports, generated outputs,
  traces, and resumable checkpoints.
- Managed state: tasks, deployments, documents, tickets, tracked resources, or
  app-specific ledgers.
- Memory and behavior: durable instructions, knowledge, preferences, tone,
  operating principles, and agent behavior snapshots.
- Decisions: durable "why" records with evidence, alternatives, confidence,
  provenance, and freshness.
- Triggers: heartbeats, webhooks, scheduled checks, external events, and
  domain-specific monitors.

## Current UI Baseline

- Default assistant-ui chat is the normal screen.
- Normal chat uses Cloudflare Agents through `app/assistant.tsx`.
- `/new` starts a local blank session immediately and only materializes a
  Cloudflare thread when the first message is sent.
- The runtime hint shows server-derived workspace, agent/profile, chat state,
  and error detail.
- Recent chat state and active-thread switching are Cloudflare-owned.
- `/agents` opens a compact agent picker. Active-agent pack workflows populate
  the `/` composer menu when they have a safe dry-run binding.
- Repository Analyst, Polymancer Research, and Swordfish Runtime have current
  pack workflow bindings that create Cloudflare-owned workflow intents, runs,
  tool calls, artifacts, audit events, and history entries through a shared
  lifecycle helper.
- `/history` opens the product-facing workbench history drawer for recent
  scoped runs, selected-run summaries, tool calls, and metadata-only artifacts.
  The runtime hint also links directly to this surface.
- `/workspace` opens the product-facing account and access panel for WorkOS
  organization switching, assigned workspace switching, workspace creation,
  and owner/admin member controls.
- History exposes supported cancellation and pack-workflow retry plus approval
  resume/deny actions. Connection failures expose a direct reconnect action.
- `/admin` opens a server-gated Admin panel and is stripped before model send.
- Admin uses four focused tabs: Overview, Agents & Packs, Tools & Approvals,
  and Diagnostics. It keeps pack activation and pending approvals prominent,
  isolates traces/raw state in Diagnostics, and links normal workspace, agent,
  and history work to their dedicated surfaces.
- Cloudflare exposes backend execution and artifact history metadata through
  scoped workbench APIs. The normal `/history` surface can inspect recent runs
  and metadata-only artifacts; Admin remains the deeper diagnostic surface.
  There is no blob artifact storage yet.
- The diagnostic `demo.inspect` path exists only as compatibility coverage for
  the original Cloudflare-owned run slice. It should not shape the product.

## Near-Term Milestones

1. Keep the connected workbench local-feeling: fast first paint, immediate
   draft input, responsive thread switching, and background Cloudflare
   reconciliation.
2. Expand `/history` from metadata summaries into richer artifact previews,
   filtering, export/delete behavior, and blob-backed storage once migration
   and retention gates exist.
3. Expand code-first agent packs from template import/preview and the current
   Polymancer/Swordfish workflow bindings into
   tool-specific configuration, context assembly, smoke scenarios, and package
   verification.
4. Harden model-side tool rendering and approval explanations before broader
   model-visible tool use.
5. Add swappable domain context configuration for downstream apps and customer
   integrations without introducing a committed `Project` entity too early.
6. Broaden read-only tool adapters beyond `url.inspect` and `repo.snapshot`
   while keeping mutation-capable tools behind the production gates.
7. Move the remaining Fly/LangGraph producers onto the generic scoped callback
   path.
8. Add generic managed-state, audit, and decision-record surfaces after the
   read-only 1.0 release boundary is proven.

## Component Rules

- Keep `components/assistant-ui/*` reusable and product-agnostic.
- Put workbench-specific composition around the thread, not inside low-level
  message rendering.
- Prefer typed data passed into reusable components over global assumptions.
- Keep domain language in reference app configuration. Base components should
  use generic terms such as managed state, ledger, triggers, tools, memory, and
  policy.
- Treat tenant scope as server-derived runtime data, not prompt text.
- Treat tool execution as server-side only. The frontend may request, approve,
  inspect, or configure tools, but it must never receive provider keys, user
  credentials, or tool secrets.

## Tool Requirements

- A new typed tool should be addable with a small module declaring name,
  description, execution function, and proven metadata.
- CLI tools, OSS packages, scripts, and git submodules should sit behind the
  same tool interface as native TypeScript tools.
- Availability should be configurable per user/workspace/agent and deployment.
- Mutation-capable tools must support ask, dry-run, and execute modes, with
  policy checks outside the model.
- Tool output should be structured enough for UI, artifacts, failures, and
  follow-up actions without parsing prose.

## Design Principle

This should feel like an operator surface for serious work: dense,
inspectable, and calm. Avoid turning the workbench into a marketing page or a
generic chatbot wrapper.
