# Architecture

Assistant-mk1 is a reusable agent workbench with a conversational control plane, workflow execution plane, and hosted dev/staging split across Vercel, Cloudflare, and Fly.

The architecture is generic, but it is evaluated against demanding reference
apps such as Polymancer, deployment agents, and the Personal Job Agent.
Reference apps are stress tests for long-running autonomy, secrets, ledgers,
execution policy, tools, external triggers, browser automation, and multi-user
isolation. The primitives must remain reusable across agent projects.

Document status: this page describes the current system shape plus target
subsystems. For the current-vs-target docs map, start with `docs/README.md`.

## System Shape

- Next.js App Router serves the frontend and browser-facing API facade.
- WorkOS AuthKit runs through the Next.js SDK at the Vercel web boundary.
- assistant-ui renders the thread, composer, messages, reasoning, tools, and attachments.
- `@assistant-ui/react-langgraph` adapts the UI runtime to the LangGraph-shaped
  thread and stream contract. Hosted simple chat is served by Cloudflare behind
  that compatibility contract.
- Vercel derives trusted WorkOS user, account source, and external membership
  signals before calling Cloudflare server-to-server.
- Cloudflare owns membership and agent authorization, durable workbench run
  control, tenant state, audit records, and mediated storage access.
- Workspaces are customer/team tenant boundaries. Agents are runtime assistant
  configurations scoped to a workspace.
- Fly runs LangGraph workflow services and signed server-side executor work for
  heavy execution.
- LangGraph currently remains available through the starter backend graph
  exported from `backend/agent.ts` for workflow/escalation testing.
- OpenRouter is configured server-side for Cloudflare simple chat and for the
  Fly/LangGraph workflow runtime.
- Vercel hosts the deployed Next.js frontend.

## Control Plane Shape

- Conversational agent: fast user-facing loop for chat, notes, memory, strategy, managed state, and status questions.
- Intent router: converts eligible requests, schedules, tool events, and external triggers into typed workflow intents.
- Policy layer: validates tenant scope, tool permissions, execution mode, approvals, and kill switches before execution.
- Run control: tracks foreground, background, workflow, and child executions with status, heartbeat, interrupt, cancellation, recovery, and parent/child metadata.
- Workflow engine: executes typed intents through the best backend for the job. LangGraph is preferred for complex workflows with graph semantics, interrupts, and resumability.
- Tool runner: executes server-side tools, including CLIs, OSS packages, scripts, submodules, API tools, and heavy jobs.
- Canonical state: all durable outputs return to scoped memory, decision records, managed state, ledgers, artifacts, and audit logs.

The generic workflow lifecycle is:

```txt
observe -> analyze -> propose -> execute -> review
```

This maps to Polymancer as market observation, conviction analysis, trade proposal, order execution, and position review. It also maps to deployment workflows as CI observation, failure analysis, fix proposal, deployment execution, and log review.

For implementation-level infrastructure responsibilities, see `docs/infrastructure.md`, `docs/cloudflare-control-plane.md`, `docs/fly-tool-runners.md`, `docs/data-and-state.md`, and `docs/secrets-and-risk.md`.

## Generic Subsystems

- Identity and tenancy: every thread, run, secret, memory item, ledger entry,
  strategy, trigger, tool permission, agent, and artifact belongs to a user or
  workspace.
- Tool registry: tools are first-class runtime modules with typed inputs/outputs, permissions, execution policy, timeout policy, logging policy, and per-user/workspace availability.
- Tool exposure resolver: a policy/runtime boundary that narrows registered tools to the model-visible set for a specific tenant, agent, workflow stage, execution mode, and child-run context.
- CLI and OSS adapters: local CLIs, OSS packages, scripts, and git submodules should run server-side behind the same tool interface as native tools.
- Secret custody: user credentials and API keys must be encrypted, scoped, revocable, never exposed to the browser, and only available to approved server-side tools.
- Agent runtime: conversational state and workflow state are separate concerns. LangGraph remains the preferred complex workflow engine behind escalation, while a Cloudflare-style stateful agent can own live per-user/workspace coordination.
- Ledger and audit trail: planned actions, proposed actions, executed actions, skipped actions, model rationale, tool calls, external triggers, and policy blocks should be recorded.
- Decision records: important beliefs, strategies, plans, actions, and policy decisions should be stored with evidence, counter-evidence, confidence, alternatives, provenance, related artifacts, and freshness.
- Knowledge/personality: users can configure durable instructions, project knowledge, preferences, risk tolerance, tone, decision style, review cadence, and domain-specific operating principles.
- Policy layer: ask, dry-run, execute, human approval, per-user limits, allowlists/denylists, cooldowns, and kill switches are framework primitives.
- Observability: every long-running process needs run status, last heartbeat, next scheduled check, active tools, current managed state, and failure reason.
- Lifecycle events: typed runtime events should drive audit records, UI timelines, policy checks, and future hook surfaces before arbitrary user-installed hooks exist.

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

Tools should execute server-side. Browser code can show tool state, request an action, approve a pending action, or inspect results, but it must not receive provider keys, user credentials, or other tool secrets.

## Deployment Boundary

Local development runs both servers:

```bash
pnpm dev
```

The active hosted dev baseline is split:

```txt
Browser -> Vercel Next.js frontend
        -> WorkOS AuthKit session via Next SDK
        -> Vercel same-origin API facade
        -> Cloudflare Worker/D1 for workspace authz and run control
        -> Fly runtime executor for signed work

Browser -> Vercel Next.js /api facade
        -> Cloudflare /langgraph compatibility facade
        -> Cloudflare simple chat runtime for normal messages
        -> Fly LangGraph runtime gateway for explicit escalation
```

Vercel owns hosted web sign-in and the browser-facing API facade. Cloudflare is
the authorization, control-plane, and canonical-state boundary; Fly remains the
execution plane. The LangGraph-compatible facade keeps assistant-ui usable while
Cloudflare-owned conversational stream ownership is built out.
