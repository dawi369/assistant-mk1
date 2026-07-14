# Capability Model

Assistant-mk1 grows through explicit capability levels rather than by giving a
model ambient authority. Each level adds a class of work and requires the
control-plane guarantees needed to operate it safely.

Document status: north-star target contract. Levels 0 and 1 are implemented.
Level 2 is preview-complete only when the repository release gates pass; it does
not imply retained data or mutation authority. Level 3 now has a checked-in,
read-only implementation foundation, but is not a release-conformant or
production-unattended capability. Levels 4 and 5 remain target behavior.

Executable evidence is mapped in `level-2-conformance.md` and
`level-3-conformance.md`. A local Level 3 pass still requires separate hosted
unattended-operation evidence before release.

## Capability Levels

| Level | Capability                  | Required platform guarantees                                                                             |
| ----- | --------------------------- | -------------------------------------------------------------------------------------------------------- |
| 0     | Conversational              | Scoped identity, behavior snapshot, thread continuity, and bounded context                               |
| 1     | Tool-using                  | Typed tools, model exposure policy, structured results, timeouts, redaction, and audit                   |
| 2     | Workflow-driven             | Typed intents, durable runs, artifacts, interrupts, cancellation, retry, and recovery                    |
| 3     | Background and event-driven | Trusted triggers, schedules, idempotency, leases, heartbeats, concurrency limits, and replay             |
| 4     | Delegated                   | Parent/child lineage, depth and budget limits, narrowed tools, durable handoff, and cascade cancellation |
| 5     | Externally mutating         | Encrypted connections, dry-run, approvals, limits, ledgers, kill switches, and retained audit evidence   |

Levels are cumulative. A pack cannot claim a higher level by prompt wording or
manifest metadata alone. Its runtime bindings, workspace policy, deployment,
and verification evidence must satisfy every required lower-level guarantee.

## Current Level 3 Boundary

The checked-in Level 3 foundation currently provides:

- API v2 schedule, monitor, and webhook declarations bound only to registered
  checked-in pack workflows.
- Tenant-scoped D1 trigger and dispatch records, operator CRUD, optimistic
  versioning, audit/events, idempotency keys, and per-trigger concurrency limits.
- A Cloudflare cron tick for due schedule/monitor dispatch, bounded occurrence
  coalescing, lease/heartbeat timestamps, callback-owned completion,
  expired-lease recovery, and replay of failed or cancelled dispatches.
- Public webhook ids with a secret returned only at creation, only a hash stored
  in D1, constant-time verification, bounded normalized input, and idempotent
  dispatch creation.
- Durable deduplicated operator alerts for immediate execution failures and
  expired leases, with bounded signed HTTPS delivery and audited resolution.
- Forward-only retained-data migrations, bounded artifact/event/trace retention,
  deterministic D1 backup/restore evidence, and scoped preview export inventory.

This is not yet a Level 3 release claim. Hosted schedule/webhook conformance,
long-duration lease-renewal and soak evidence, hosted alert receipt, R2 restore,
streaming export, complete Durable Object deletion, and an operator-ready
unattended-production runbook remain gates. Trigger execution remains read-only
and does not grant credentials or external mutation authority.

## Agent Pack Composition

Agent Packs are the product extension boundary. The complete target contract
can declare, but cannot bypass platform enforcement for:

- behavior and model guidance
- user, agent, and workflow tool requirements
- typed workflows and execution engines
- trusted, retrieved, and untrusted context sources
- user-facing starters, forms, managed-state views, and artifact renderers
- managed-state and decision-record extension schemas
- schedules, webhooks, monitors, and other trigger bindings
- required external connections and secret classes, never secret values
- execution modes, risk posture, limits, budgets, and approval requirements
- evals, smoke scenarios, health checks, migrations, and compatibility bounds

Pack manifests remain serializable declarations. Trusted tool implementations,
workflow handlers, connection brokers, storage migrations, and policy
enforcement remain registered platform code. Installing a pack never grants
authority by itself.

## Domain State And UX

The base workbench owns generic product surfaces: chat, run control, History,
approvals, tools, artifacts, managed state, decisions, connections, and Admin.
A pack may contribute typed descriptors and renderers to those surfaces without
forking core navigation or introducing domain tables into the platform model.

Pack-owned state uses platform records with namespaced extension data until a
shape proves generic. The pack declares how operators list, inspect, filter,
and act on that state. Cloudflare still derives tenant scope, authorizes every
operation, and writes canonical run, audit, artifact, decision, and ledger
records.

## Runtime Invariants

- The model never chooses tenant scope, tool authority, credentials, budgets,
  approval bypass, or kill-switch state.
- Background work is idempotent at its trigger boundary and has a durable owner,
  lease, heartbeat, and concurrency policy.
- Delegated work inherits scope, receives narrower capabilities, and returns
  structured outputs with durable lineage.
- Mutation requires a dry-run representation or a documented policy exception;
  unsupported mutation remains disabled.
- Important outcomes become durable records. Conversation summaries are indexes,
  not truth.
- Every capability can explain what ran, why it was allowed, what it changed,
  what it cost, and how an operator can stop or recover it.

## Portability Boundary

The first implementation is intentionally opinionated: Next.js and WorkOS at
the web boundary, Cloudflare for authorization and canonical control state, and
Fly/LangGraph for heavy execution. Portability comes from stable pack, tool,
workflow, policy, context, and data-client contracts, not from pretending every
infrastructure component is already interchangeable.

An external SDK, remote pack installation, or alternate infrastructure adapter
should ship only after downstream use proves these contracts. Replacement
implementations must preserve tenant derivation, policy enforcement, durable
lineage, redaction, and audit semantics.
