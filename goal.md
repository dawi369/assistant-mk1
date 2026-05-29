# Assistant-MK1 Goal

## Product Goal

Build a reusable, smart agent frontend that can be adapted across complex projects. The first product shape is an agent workbench: chat is the main interaction surface, but the system must also expose project context, run state, long-running task controls, interrupts, artifacts, and external starts.

## Current Direction

- Develop and test locally for fast iteration.
- Use Fly.io as the hosted dev/staging runtime after feature slices.
- Keep docs repo-native in Markdown so coding agents and humans share the same source of truth.
- Use LangGraph Agent Server concepts directly: threads, runs, interrupts, crons, and webhooks.
- Keep OpenRouter provider credentials server-side.

## Phase 1: Foundation

Status: in progress.

- Add repo operating docs.
- Standardize on npm because `package-lock.json` is tracked.
- Add health check and Fly staging config.
- Add token-protected external signal ingress.
- Verify local typecheck, build, lint, and dev smoke.

## Phase 2: Workbench UX

Status: planned.

- Add project context surface.
- Show thread/run status in the UI.
- Add interrupt approval/resume flows.
- Add artifact and execution history surfaces.
- Keep base assistant-ui components reusable.

## Phase 3: Durable Runtime

Status: planned.

- Validate persistence behavior for interrupted work across restart.
- Add first cron-triggered workflow.
- Add first external webhook/signal integration.
- Decide whether production persistence needs managed LangGraph Platform, Postgres-backed self-hosting, or another durable store.

## Done Bar

A feature is done when it is documented, locally verified, and smoke-tested on Fly staging when it affects runtime behavior.
