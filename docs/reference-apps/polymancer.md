# Polymancer Reference App

Polymancer is the reference target for Assistant-MK1. It is not the whole product scope. It is the demanding benchmark that proves the framework can support real multi-user, long-running, tool-using agents.

## Vision

Polymancer is a personal Polymarket trader in your pocket: conversational, stateful, available 24/7, and able to act through approved tools. A user should be able to discuss world events, share intuition, define a thesis, copy-watch a wallet, monitor a sector, and ask the assistant what it believes, what it owns, what it plans, and why.

The closest useful version is not just an LLM that can place orders. It is an operator with memory, tools, a ledger, conviction state, monitoring loops, risk policies, and a clear audit trail.

## Why This Reference App Matters

Trading stress-tests the framework:

- Autonomy: heartbeats, monitors, and external triggers need to run without an open browser.
- Secrets: user credentials must be encrypted, scoped, revocable, and server-side only.
- Tools: market data, wallet research, copy-trading, order previews, and execution adapters need a boring plug-in path.
- Ledgers: every proposed, skipped, blocked, and executed action needs a durable record.
- Risk: full autonomy still needs dry-run mode, approval gates, limits, allowlists, denylists, cooldowns, and kill switches.
- Multi-user isolation: every user needs separate accounts, memory, tools, ledgers, schedules, and secrets.

These requirements are generic. The same framework should support non-trading agents for deployments, research, documents, tickets, operations, and other complex workflows.

## Core Capabilities

- Wallet and copy-trading research: monitor wallets, infer behavior, and explain what is worth copying or avoiding.
- Sector sniping: watch user-defined topics, tags, narratives, or event clusters for fast opportunities.
- Market discovery: search, rank, and compare markets by liquidity, spread, volume, timing, relevance, and thesis fit.
- Conviction tracking: keep current beliefs, confidence, evidence, counter-evidence, and what would change the plan.
- Position review: explain current holdings, exposure, pending orders, realized/unrealized results, and planned next steps.
- Heartbeats: run scheduled checks that update state even when the user is not present.
- Rapid-move triggers: wake on price, volume, wallet, or event movement.
- User knowledge: store durable notes, thesis fragments, preferences, risk appetite, banned markets, favored sectors, and decision style.
- Personality: configure tone, communication style, patience, skepticism, and how aggressively the assistant should challenge assumptions.

## Framework Mapping

Polymancer-specific behavior must map to generic Assistant-MK1 primitives:

- Polymarket account -> user/workspace identity and secret custody.
- Trading tools -> typed server-side tools with permissions and deterministic execution modes.
- Open positions -> managed state and ledger entries.
- Trade proposals -> pending actions and artifacts.
- Submitted orders -> executed actions and audit events.
- Copy-trading monitor -> external trigger or scheduled run.
- Sector sniping -> configured monitor with tool access and schedule.
- User thesis -> memory/personality item with provenance.
- Conviction update -> strategy state snapshot.
- Trade approval -> interrupt/resume flow.
- Kill switch -> risk policy and runtime control.

## Generic Workflow Lifecycle

Polymancer maps to the generic lifecycle:

```txt
observe markets -> analyze conviction -> propose trade -> execute order -> review position
```

Other apps should use the same framework:

```txt
observe CI -> analyze failure -> propose fix -> execute deploy -> review logs
```

```txt
observe source docs -> analyze gaps -> propose edits -> execute revision -> review diff
```

The lifecycle is intentionally generic. Polymancer is a stress test, not a special-case runtime.

## Tooling Requirement

The framework must make tool implementation easy enough that a new project can add domain tools without changing the core workbench.

Tool types to support:

- Native TypeScript tools.
- API-backed tools.
- CLI-backed tools.
- OSS packages wrapped in process or library adapters.
- Git submodules or vendored OSS tools run behind a stable server-side adapter.

Every tool should declare:

- Name, description, and project/domain.
- Input schema and output schema.
- Required secrets and permissions.
- Risk level and whether dry-run is supported.
- Timeout and cancellation behavior.
- Logging and redaction policy.
- Artifact outputs, if any.
- User/workspace availability.

Tools should never run in browser code. The frontend should display tool availability, approvals, logs, results, and failures.

## Polymarket Adapter Family

Polymarket tools should be one adapter family, not hard-coded framework behavior. Official docs currently split capability across:

- [API overview](https://docs.polymarket.com/api-reference/introduction): Gamma, Data, and CLOB APIs.
- [Market data overview](https://docs.polymarket.com/market-data/overview): public market data with no auth, including Gamma, CLOB price/orderbook data, and Data API positions/activity.
- [Trading overview](https://docs.polymarket.com/trading/overview): CLOB trading flow, SDKs, and order lifecycle.

The first adapter should be read-only or dry-run. Live trading is not production-ready until auth, encrypted secrets, ledgers, auditability, permissions, risk limits, and kill switches exist.

## Multi-User Requirement

Polymancer cannot be treated as a single global bot. Each user or workspace must have isolated:

- Credentials and wallet/API keys.
- Threads and runs.
- Tool permissions.
- Schedules and external triggers.
- Memory and personality.
- Managed state and ledger.
- Risk policies and kill switches.
- Audit trail and artifacts.

Shared infrastructure can host many users, but no agent run should be able to cross user/workspace boundaries accidentally.

## Acceptance Scenarios

- Two users can run separate agents with separate memories, ledgers, secrets, tools, and schedules.
- A new typed tool can be added with minimal framework changes and shown in the runtime/tool UI.
- A local CLI or OSS submodule can be wrapped as a server-side tool with timeout, logs, and typed output.
- Frontend code cannot access credentials, and logs/API responses do not expose secrets.
- A scheduled heartbeat creates a run, updates state, and records an audit event.
- An external event wakes the right user/workspace agent and creates or resumes the correct thread.
- A high-risk action can pause, request approval, resume, and record the decision.
- The agent can propose a high-risk action in dry-run mode without executing it.
- A risk policy blocks an action that exceeds configured limits and records the block.
- The user can ask, "what are you doing and why?" and receive an answer grounded in managed state, strategy state, and recent runs.
- Fly staging can show agent state, tool history, run history, and external-trigger behavior.

## Boundary

Assistant-MK1 remains the reusable framework. Polymancer is the reference benchmark and a future proving app. Trading gets special attention because it stress-tests the architecture, but non-trading projects remain first-class.
