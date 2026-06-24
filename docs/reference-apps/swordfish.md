# Swordfish Reference App

Swordfish is a reference app for production market-data operations. It is not
the Assistant-mk1 product identity; it is a concrete pressure test for agents
that need live runtime health, bounded market-data reads, and inspectable
reports without exposing provider credentials.

## Current Slice

The `baby-swordfish` pack is a read-only single-agent app seed. It uses the
public Swordfish backend at `https://swordfish-backend-production.up.railway.app`
through fixed server-side adapters only.

It does not use `HUB_API_KEY`, Railway tokens, Massive credentials, admin
endpoints, direct provider access, mutation routes, or browser-side secrets.

## Why This Reference App Matters

Swordfish stresses a different product shape from Polymancer:

- Live-data health: the agent can explain whether Redis, durable bars, snapshots,
  and upstream ingestion look usable before doing research.
- Runtime operations: the report is about system state and market-data freshness,
  not just a market thesis.
- Bounded reads: tools fetch compact snapshots and recent bars with strict symbol,
  timeframe, and range limits.
- Provider isolation: Assistant-mk1 talks to the Swordfish product API, not to
  Massive or internal infrastructure directly.
- Auditability: workflow runs, tool calls, and generated reports land in the
  same history/artifact path as other workbench actions.

## Framework Mapping

Swordfish-specific behavior maps to generic Assistant-mk1 primitives:

- Runtime health -> read-only tool call and audit summary.
- Open ticker and symbol catalog -> compact tool output metadata.
- Symbol snapshot -> typed market-data adapter output.
- Recent bars -> bounded time-series read with max returned bars.
- Runtime research report -> artifact metadata attached to a workflow run.
- Demo selection -> pack-backed agent activation in the workbench shell.

## Current Tools

- `swordfish.runtime.overview`: reads public health, open ticker, symbols, and
  compact snapshot counts.
- `swordfish.symbol.snapshot`: reads a bounded uppercase futures symbol snapshot.
- `swordfish.bars.range`: reads recent bars for a bounded symbol/timeframe/range.

All Swordfish tools are registered as read-only, Admin-visible, model-hidden by
default, and dry-run only.

## Current Workflow

`swordfish.runtime_research` is declared as a future LangGraph workflow in the
pack contract and implemented today through the Cloudflare-owned workflow/history
path.

- Vercel facade: `POST /api/workbench/workflows/swordfish/runtime-research`
- Worker route: `POST /workflows/swordfish/runtime-research`
- Required active pack: `baby-swordfish`

The workflow runs runtime overview, optional symbol snapshot, optional recent
bars, and writes one compact runtime research report artifact.

## Boundary

Swordfish v0 is public read-only. Trading, order routing, admin actions,
provider secrets, infrastructure tokens, mutation tools, and private data remain
out of scope.
