# Assistant-MK1 Goal

## Product Goal

Build a reusable, smart agent frontend that can be adapted across complex projects. The first product shape is an agent workbench: chat is the main interaction surface, but the system must also expose project context, run state, long-running task controls, interrupts, artifacts, and external starts.

The reference target is Polymancer: a future Polymarket-focused assistant that proves the framework can handle 24/7 autonomy, user-specific knowledge, tool execution, ledgers, market monitoring, secrets, and multi-user isolation. Polymancer is a benchmark, not the whole scope. Assistant-MK1 must stay useful for non-trading projects that need the same generic primitives.

## Current Direction

- Develop and test locally for fast iteration.
- Use Fly.io as the hosted dev/staging runtime after feature slices.
- Keep docs repo-native in Markdown so coding agents and humans share the same source of truth.
- Use LangGraph Agent Server concepts directly: threads, runs, interrupts, crons, and webhooks.
- Keep OpenRouter provider credentials server-side.
- Make tool implementation boring and repeatable. A project should be able to add typed tools, wrap CLI tools, or run OSS packages/submodules as agent tools without rewriting the framework.
- Treat multi-user support as an early architecture constraint: user/workspace identity must scope threads, runs, secrets, tools, memory, ledgers, triggers, and artifacts.

## Phase 1: Foundation

Status: in progress.

- Add repo operating docs.
- Standardize on pnpm because `pnpm-lock.yaml` is tracked.
- Add health check and Fly staging config.
- Add token-protected external signal ingress.
- Verify local typecheck, build, lint, and dev smoke.

## Phase 2: Workbench UX

Status: planned.

- Add project context surface.
- Show thread/run status in the UI.
- Add interrupt approval/resume flows.
- Add artifact and execution history surfaces.
- Add tool visibility: enabled tools, recent calls, permissions, risk level, and failure state.
- Add generic managed-state/ledger views that can represent trades, tasks, deployments, documents, tickets, or other domain assets.
- Keep base assistant-ui components reusable.

## Phase 3: Durable Runtime

Status: planned.

- Validate persistence behavior for interrupted work across restart.
- Add first cron-triggered workflow.
- Add first external webhook/signal integration.
- Add first typed tool adapter and first CLI/OSS-backed tool adapter.
- Define encrypted secret custody, per-user tool permissions, audit events, risk policies, and kill switches before live high-risk actions.
- Decide whether production persistence needs managed LangGraph Platform, Postgres-backed self-hosting, or another durable store.

## Done Bar

A feature is done when it is documented, locally verified, and smoke-tested on Fly staging when it affects runtime behavior.
