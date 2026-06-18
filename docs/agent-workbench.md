# Agent Workbench

The workbench is the reusable frontend layer this repo is meant to become.
Chat remains the first interface, but the product should support long-running
agent work, tools, external triggers, user knowledge, managed state, audit
trails, and multi-user isolation.

Document status: the shipped surface is assistant-ui chat plus a
command-accessed Admin panel. The broader surfaces below are direction, not a
claim that every UI exists today.

## Product Scope

The committed tenant model is workspace plus agent. A separate user-visible
project concept is not part of the current architecture. Product-specific
workbench composition can still show app/domain context, environment, docs,
repo assumptions, or app state.

Reference apps such as Polymancer, deployment agents, and the Personal Job
Agent are benchmark pressure tests. They should validate autonomy, secrets,
ledgers, browser automation, external signals, and policy without baking a
single domain into the base workbench.

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
- The runtime hint shows server-derived workspace, agent/profile, chat state,
  and error detail.
- Recent chat state and active-thread switching are Cloudflare-owned.
- `/new` creates a new thread without routing a command to the model.
- `/admin` opens a server-gated Admin panel and is stripped before model send.
- Admin leads with Cloudflare-derived runtime visibility: trace graph,
  waterfall, chat readiness, active workspace, active agent/profile, latest
  meaningful event, and important error.
- Admin has secondary workspace/agent controls, behavior template import and
  preview, tool registry visibility, `url.inspect`, approval queue, and
  policy/model-exposure explanations.
- Cloudflare exposes backend execution and artifact history metadata through
  scoped workbench APIs, but there is no dedicated customer-facing history UI
  or blob artifact storage yet.
- The diagnostic `demo.inspect` path still exists as compatibility coverage for
  the original Cloudflare-owned run slice.

## Near-Term Milestones

1. Use runtime traces and live-session events to stabilize chat, thread
   switching, and Admin-triggered tool request paths.
2. Finish recent chat history polish with Cloudflare-owned authorization and
   assistant-ui thread-list primitives where they fit.
3. Expand agent behavior from template import/preview into editing, version
   history, approvals, and tool-specific configuration.
4. Harden model-side tool rendering and approval explanations before broader
   model-visible tool use.
5. Build the customer-facing artifact list and execution-history UI on top of
   the Cloudflare history APIs.
6. Add swappable domain context configuration for downstream apps.
7. Add a first CLI/OSS-backed read-only tool on the runner boundary.
8. Add generic managed-state, audit, and decision-record surfaces.

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
