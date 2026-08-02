# Plan 001: Make live runtime state converge truthfully

> **Executor instructions**: Follow every step and verification gate. Update
> `plans/README.md` when done. Do not change backend run semantics to mask a UI
> synchronization problem.
>
> **Drift check**: `git diff --stat 5eb783a..HEAD -- lib/workbench/admin-summary-resource.ts lib/workbench/chat-runtime-live-state.ts lib/workbench/chat-runtime-display.ts components/workbench/workbench-runtime-hint.tsx tests/e2e/release.spec.ts`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED - refresh loops can create load or stale closures
- **Depends on**: none
- **Category**: bug
- **Planned at**: `5eb783a`, 2026-08-01

## Why this matters

The hosted UI can show a completed persisted assistant response while the
runtime badge remains `Loading` and the hint says the Admin summary is stale.
Live events are authoritative for immediate state; the Admin summary should
converge shortly afterward without gating a valid composer.

## Current state

- `lib/workbench/admin-summary-resource.ts:11,83-94,164-172` applies a 900 ms
  cooldown. An event scheduled during that window runs immediately, sees the
  cooldown, and returns without scheduling a trailing refresh.
- `lib/workbench/chat-runtime-live-state.ts:81-90` discards stale summary state.
  If the latest event is not one of the three mapped run events, `chatState` is
  undefined and `chatRuntimeStateLabel()` returns `Loading`.
- `components/workbench/workbench-runtime-hint.tsx:160-167` exposes the stale
  condition but offers no bounded recovery state.
- Existing test patterns are `lib/workbench/admin-summary-resource.test.ts`,
  `lib/workbench/chat-runtime-live-state.test.ts`, and `tests/e2e/release.spec.ts`.

## Scope

**In scope**:

- `lib/workbench/admin-summary-resource.ts`
- `lib/workbench/admin-summary-resource.test.ts`
- `lib/workbench/chat-runtime-live-state.ts`
- `lib/workbench/chat-runtime-live-state.test.ts`
- `lib/workbench/chat-runtime-display.ts`
- `components/workbench/workbench-runtime-hint.tsx`
- `tests/e2e/release.spec.ts`

**Out of scope**: Cloudflare run transitions, session token contracts, Durable
Object coordination, model streaming, or a new polling library.

## Steps

1. Replace the dropped cooldown refresh with a coalesced trailing refresh.
   Track the requested projection and highest-priority source; schedule for the
   remaining cooldown duration rather than zero. A newer request updates the
   pending request. `force` still bypasses the cooldown.

   **Verify**: `pnpm vitest run lib/workbench/admin-summary-resource.test.ts`
   passes tests using fake timers for burst coalescing, projection changes,
   forced refresh, cleanup, and exactly one trailing fetch.

2. Add bounded convergence. When a fetched summary is still older than the
   latest session event, allow at most three catch-up refreshes over ten seconds.
   Stop on freshness, component cleanup, auth/session change, or fetch failure.
   Expose `isCatchingUp` separately from initial loading; never create an
   unbounded interval.

   **Verify**: the resource tests prove the retry cap and no timer remains after
   reset/unsubscribe.

3. Make runtime labels truthful. Preserve run state from a live run event. When
   the session stream is connected but the summary is stale and the latest event
   is not a run-state event, label the runtime `Syncing` rather than `Loading`.
   Keep the Cloudflare connection `Live`. Summary staleness alone must not make
   session access false or disable the composer.

   **Verify**: `pnpm vitest run lib/workbench/chat-runtime-live-state.test.ts lib/workbench/session-access.test.ts`
   passes new cases for completed run -> trace event -> stale summary -> fresh
   summary, disconnected stale state, and composer access.

4. Update the runtime hint to distinguish initial connection, live-but-syncing,
   cached shell, and failed synchronization. Use existing status components and
   tokens; do not add a new visual system.

5. Add a deterministic browser regression: send a message, observe completed
   output, deliver a later non-run session event inside the cooldown, and assert
   the badge converges to `Completed` or `Ready`, the stale hint disappears, and
   the composer can send another message without reload.

   **Verify**: `pnpm test:e2e:local:release` passes.

## Done criteria

- No refresh request is silently dropped by the cooldown.
- Catch-up performs at most three requests and always cleans up timers.
- A connected usable session never shows indefinite `Loading` solely because
  an Admin summary is stale.
- The composer remains governed by live session/token access, not summary age.
- Focused tests, `pnpm typecheck`, `pnpm lint`, and local release E2E pass.

## STOP conditions

- Stop if composer disablement originates inside assistant-ui runtime state and
  cannot be changed without modifying streaming or backend run semantics.
- Stop if the fix requires continuous polling rather than bounded convergence.
- Stop if a backend event lacks both a monotonic revision and timestamp; report
  the missing contract before inventing another freshness heuristic.

## Maintenance notes

Review timer ownership carefully. All module-level timers must be reset between
tests and after logout. Future event types should either map to workload state or
leave the last authoritative workload state intact.
