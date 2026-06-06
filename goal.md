# Assistant-MK1 Goal

## Product Goal

Build a reusable, smart agent frontend that can be adapted across complex projects. The first product shape is an agent workbench: chat is the main interaction surface, but the system must also expose project context, run state, long-running task controls, interrupts, artifacts, and external starts.

The reference target is Polymancer: a future Polymarket-focused assistant that proves the framework can handle 24/7 autonomy, user-specific knowledge, tool execution, ledgers, market monitoring, secrets, and multi-user isolation. Polymancer is a benchmark, not the repo identity. Assistant-MK1 must stay general enough for many agent projects that need the same primitives.

## Current Direction

- Develop and test locally for fast iteration.
- Use Vercel for the hosted web/session boundary, Cloudflare Worker/D1 for
  app authorization and control-plane ownership, and Fly.io for LangGraph/tool
  execution.
- Keep docs repo-native in Markdown so coding agents and humans share the same source of truth.
- Use LangGraph Agent Server concepts directly: threads, runs, interrupts, crons, and webhooks.
- Keep OpenRouter provider credentials server-side.
- Make tool implementation boring and repeatable. A project should be able to add typed tools, wrap CLI tools, or run OSS packages/submodules as agent tools without rewriting the framework.
- Treat multi-user support as an early architecture constraint: user/workspace identity must scope threads, runs, secrets, tools, memory, ledgers, triggers, and artifacts.
- Split fast conversation from complex workflow execution. The conversational agent should answer from canonical state and escalate typed workflow intents only when needed.
- Store important past reasoning as flexible decision records with evidence, counter-evidence, confidence, provenance, artifacts, and freshness.

## Phase 1: Foundation

Status: mostly implemented for the current pre-user hosted baseline.

- Add repo operating docs.
- Standardize on pnpm because `pnpm-lock.yaml` is tracked.
- Add health check and Fly staging config.
- Add token-protected external signal ingress.
- Add basic infrastructure docs for Cloudflare control plane, Fly tool runners, storage, secrets, and execution policy.
- Add docs-first DB contracts for tenant-scoped durable entities and data-client boundaries.
- Add WorkOS hosted sign-in through Vercel.
- Add Cloudflare D1-backed users, workspaces, memberships, active workspace
  preference, operator-provisioned agents, and active agent routing.
- Verify local typecheck, build, lint, and dev smoke.

## Phase 2: Workbench UX

Status: partially implemented as default chat plus Dev Monitor.

- Keep default assistant-ui chat as the normal app surface.
- Use Dev Monitor for current account, workspace, membership, agents, chat path,
  demo path, events, errors, and workspace/agent operator controls.
- Add interrupt approval/resume flows when a real workflow needs them.
- Add artifact and execution history surfaces beyond the current diagnostic
  slice.
- Add tool visibility: enabled tools, recent calls, permissions, execution policy, and failure state.
- Add generic managed-state/ledger views that can represent trades, tasks, deployments, documents, tickets, or other domain assets.
- Add decision-record views so users can ask why the agent believes or planned something and get a provenance-backed answer.
- Keep base assistant-ui components reusable.

## Phase 3: Durable Runtime

Status: partially implemented around Cloudflare-owned control-plane state.

- Validate persistence behavior for interrupted work across restart.
- Validate the Cloudflare control-plane and Fly tool-runner split with more
  than the current signed `demo.inspect` diagnostic.
- Add first cron-triggered workflow.
- Add first external webhook/signal integration.
- Add first CLI/OSS-backed tool adapter.
- Add first typed workflow intent and generic lifecycle demo using `observe -> analyze -> propose -> execute -> review`.
- Define encrypted secret custody, per-user tool permissions, audit events, execution policies, and kill switches before live external mutation.
- Decide whether production persistence needs managed LangGraph Platform, Postgres-backed self-hosting, or another durable store.

## Done Bar

A feature is done when it is documented, locally verified, and smoke-tested on Fly staging when it affects runtime behavior.
