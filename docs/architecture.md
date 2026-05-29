# Architecture

Assistant-MK1 is a reusable agent workbench with a conversational control plane, workflow execution plane, and hosted Fly.io dev/staging runtime.

The architecture is generic, but it is evaluated against a demanding reference app: Polymancer, a future Polymarket-focused assistant. Trading is useful as a stress test because it requires long-running autonomy, secrets, ledgers, risk controls, tools, external triggers, and multi-user isolation. Those same primitives must remain reusable for non-trading projects.

## System Shape

- Next.js App Router serves the frontend and API routes.
- assistant-ui renders the thread, composer, messages, reasoning, tools, and attachments.
- `@assistant-ui/react-langgraph` adapts the UI runtime to LangGraph threads and streams.
- LangGraph currently runs the starter backend graph exported from `backend/agent.ts`.
- OpenRouter is configured server-side through `ChatOpenRouter`.
- Fly.io runs the staging environment after local feature implementation.

## Control Plane Shape

- Conversational agent: fast user-facing loop for chat, notes, memory, strategy, managed state, and status questions.
- Intent router: converts eligible requests, schedules, tool events, and external triggers into typed workflow intents.
- Policy layer: validates tenant scope, tool permissions, risk, approvals, dry-run requirements, and kill switches before execution.
- Workflow engine: executes typed intents through the best backend for the job. LangGraph is preferred for complex workflows with graph semantics, interrupts, and resumability.
- Tool runner: executes server-side tools, including CLIs, OSS packages, scripts, submodules, API tools, and heavy jobs.
- Canonical state: all durable outputs return to scoped memory, decision records, managed state, ledgers, artifacts, and audit logs.

The generic workflow lifecycle is:

```txt
observe -> analyze -> propose -> execute -> review
```

This maps to Polymancer as market observation, conviction analysis, trade proposal, order execution, and position review. It also maps to non-trading apps such as CI observation, failure analysis, fix proposal, deployment execution, and log review.

For implementation-level infrastructure responsibilities, see `docs/infrastructure.md`, `docs/cloudflare-control-plane.md`, `docs/fly-tool-runners.md`, `docs/data-and-state.md`, and `docs/secrets-and-risk.md`.

## Generic Subsystems

- Identity and tenancy: every thread, run, secret, memory item, ledger entry, strategy, trigger, tool permission, and artifact belongs to a user or workspace.
- Tool registry: tools are first-class modules with typed inputs/outputs, permissions, risk level, timeout policy, logging policy, and per-user/workspace availability.
- CLI and OSS adapters: local CLIs, OSS packages, scripts, and git submodules should run server-side behind the same tool interface as native tools.
- Secret custody: user credentials and API keys must be encrypted, scoped, revocable, never exposed to the browser, and only available to approved server-side tools.
- Agent runtime: conversational state and workflow state are separate concerns. LangGraph remains the preferred complex workflow engine behind escalation, while a Cloudflare-style stateful agent can own live per-user/workspace coordination.
- Ledger and audit trail: planned actions, proposed actions, executed actions, skipped actions, model rationale, tool calls, external triggers, and risk blocks should be recorded.
- Decision records: important beliefs, strategies, plans, actions, and risk decisions should be stored with evidence, counter-evidence, confidence, alternatives, provenance, related artifacts, and freshness.
- Knowledge/personality: users can configure durable instructions, project knowledge, preferences, risk tolerance, tone, decision style, review cadence, and domain-specific operating principles.
- Risk layer: dry-run, human approval, per-user limits, allowlists/denylists, cooldowns, and kill switches are framework primitives, not trading-only features.
- Observability: every long-running process needs run status, last heartbeat, next scheduled check, active tools, current managed state, and failure reason.

## Important Seams

- `app/assistant.tsx`: creates the LangGraph SDK client and assistant-ui runtime.
- `lib/chatApi.ts`: decides whether the browser talks to `/api` or a direct LangGraph URL.
- `app/api/[..._path]/route.ts`: Next.js catch-all proxy for LangGraph API requests. The bracketed folder name is framework syntax, not a project-specific naming convention.
- `app/api/external-signals/route.ts`: accepts token-protected external starts, resumes, and cron creation.
- `backend/agent.ts`: owns provider/model choice and graph behavior.
- `langgraph.json`: maps graph id `agent` to the compiled graph.

## Runtime Boundaries

The frontend should not know about model provider secrets, tool credentials, or deployment-only configuration. It should know about workbench concepts: current thread, run state, interrupts, artifacts, and messages.

The conversational runtime should own the fast dialogue loop. Complex workflows should use typed intents and workflow engines rather than frontend timers or ad hoc model decisions.

External systems should enter through authenticated API routes, not through direct browser-only flows.

Tools should execute server-side. Browser code can show tool state, request an action, approve a pending action, or inspect results, but it must not receive provider keys, trading credentials, or other tool secrets.

## Deployment Boundary

Local development runs both servers:

```bash
pnpm dev
```

Fly staging runs the same logical pair in one container:

```bash
pnpm start:fly
```

That single-container Fly shape is intentional for the dev/staging phase. If this becomes production infrastructure, revisit whether Cloudflare Agents should own the live multi-user control plane while Fly runs LangGraph workflows and heavy tool runners.
