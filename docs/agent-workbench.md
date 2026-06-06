# Agent Workbench

The workbench is the reusable frontend layer this repo is meant to become. Chat remains the first interface, but the product should support project-scale agent work: long-running processes, tools, external triggers, user knowledge, managed state, audit trails, and multi-user isolation.

Polymancer is one benchmark reference app because it stresses autonomy, secrets, ledgers, execution policy, and fast external signals. The framework must stay generic: the same surfaces should support deployment agents, research assistants, document workflows, issue triage, operations copilots, and other agent projects.

Document status: the current product surface is default assistant-ui chat plus
Dev Monitor. The workbench surfaces below are the direction, not all shipped UI.

## Core Flows

- Work context: show the active app/domain context, environment, docs, repo
  assumptions, and relevant constraints.
- Thread state: show whether the current thread is idle, running, interrupted, or errored.
- Run control: start, stop, retry, enqueue, and inspect runs without hiding the underlying state.
- Interrupts: surface approval prompts, missing-input requests, blocked tool calls, and external resume points.
- Artifacts: expose files, documents, plans, diffs, logs, screenshots, and generated outputs as first-class results.
- Execution history: show past runs, important events, and resumable checkpoints when the runtime supports them.
- Tools: show available tools, enabled tools, recent calls, permissions, execution policy, failures, and whether a tool is built in, project-specific, CLI-backed, or OSS-backed.
- Managed state: show what the agent owns or manages, such as positions, orders, tasks, deployments, documents, tickets, or tracked resources.
- Conviction/strategy: show what the agent currently believes, why, confidence, and what would change its mind.
- Triggers: show heartbeats, webhook triggers, scheduled checks, external events, and domain-specific monitors.
- Memory/personality: let users configure durable instructions, domain knowledge, preferences, risk tolerance, tone, decision style, and operating principles.
- Decision records: show the durable "why" behind beliefs, strategies, plans, and past actions, including evidence, counter-evidence, confidence, provenance, and freshness.
- Workflow lifecycle: show where work sits in `observe`, `analyze`, `propose`, `execute`, or `review`.

## Product Scope Model

The committed tenant model is workspace plus agent. A separate user-visible
project concept is not part of the current architecture. Product-specific
workbench composition can still show app/domain context, environment, docs,
repo assumptions, or app state.

## Admin Visibility

Admin visibility should become a near-term feature before broader customer
rollout. Start read-only and server-derived.

The first admin surface should show:

- Current user, workspace, membership, and active agent.
- WorkOS/account source: organization-backed account or personal fallback.
- Workspace members and membership status.
- Agent list, default agent, and status.
- Recent Cloudflare events, chat sessions, demo runs, and last errors.

This belongs in a dev/admin monitor surface first, then can graduate into a
workspace administration UI. It should never trust browser-supplied tenant or
agent ids.

Dev Monitor v1 is the first admin visibility slice. It replaces scattered
runtime widgets with one Cloudflare-backed admin summary while keeping the
existing top-right drawer and demo.inspect diagnostic action.

Workspace management v0 is the current Dev Monitor-only slice: list workspaces
for the current WorkOS account, create a name-only workspace, and switch the
active workspace through Cloudflare. This is not a customer-facing workspace
product yet; it is the operator view needed before workspace invites, role
policy, agent routing, or deeper chat debugging.

Agent routing v0 keeps agents operator-provisioned. Customers and normal app
users do not create agents in the workbench. Instead, Cloudflare resolves which
existing workspace agent should handle traffic for the current user. This lets a
client workspace have the agents configured during integration work, and lets
apps like Polymancer provision one isolated agent per user or workspace without
adding a generic agent builder.

Near-term WorkOS, workspace, and Cloudflare ownership sequence:

1. Admin visibility: show the resolved account, workspace, membership, agents,
   chat path, demo path, events, and last Cloudflare-owned error.
2. Workspace management model: list, create, default, and switch workspaces
   under a WorkOS organization or personal account. In v0 this lives only in
   Dev Monitor, and Cloudflare stores the active workspace preference.
3. Membership source of truth: keep WorkOS as enterprise identity and make
   Cloudflare D1 the app authorization layer for workspace roles and status.
   In v0, D1 membership rows stop being overwritten by WorkOS headers after
   bootstrap, active members can read admin context, and `owner`/`admin` gates
   workspace create/switch.
4. Agent routing: move from default-agent-only behavior to visible
   workspace-scoped agent list and Cloudflare-owned active-agent preference.
   Agent creation/configuration remains operator-managed for now.
5. More Cloudflare ownership: move context, policy, audit, events, run state,
   tool authorization, and eventually secret access behind Cloudflare APIs.
6. Stronger Vercel-to-Cloudflare trust boundary: replace loose trusted headers
   with a stricter signed or service-authenticated server contract.
7. WorkOS organization UX: handle org switching, personal fallback, onboarding,
   and clear current account/current workspace display.

## Component Rules

- Keep `components/assistant-ui/*` reusable and product-agnostic.
- Put project-specific workbench composition around the thread, not inside low-level message rendering.
- Prefer typed data passed into reusable components over global assumptions.
- Do not bake a single project domain into the base assistant experience.
- Keep domain-specific language in reference app configuration. Base components should use generic terms such as managed state, ledger, triggers, tools, memory, and policy.
- Treat tool execution as server-side only. The frontend may request, approve, inspect, or configure tools, but it must never receive provider keys, user credentials, or tool secrets.
- Treat tenant scope as runtime data, not prompt text. Every component that reads or writes durable state should receive scoped data from the server.

## Tool Implementation Requirements

- A new typed tool should be addable with a small module that declares name, description, execution function, and only the metadata proven necessary by real usage.
- CLI tools, OSS packages, scripts, and git submodules should be wrapped behind the same tool interface as native TypeScript tools.
- Tool availability should be configurable per user/workspace and per deployment.
- Tools that mutate external state must support deterministic execution modes such as ask, dry-run, and execute, with policy checks outside the model.
- Tool output should be structured enough for the UI to show results, failures, artifacts, and follow-up actions without parsing prose.

## UI Baseline And Next Milestones

Implemented:

- Default assistant-ui chat remains the normal screen.
- Dev Monitor provides Cloudflare-derived admin/runtime visibility.
- WorkOS, workspace, membership, and active agent scope are server-derived.
- The first typed diagnostic tool path exists through `demo.inspect`.

Next milestones:

1. Add a compact status surface for real chat/workflow run state when it is
   useful outside Dev Monitor.
2. Add interrupt display and resume actions when a workflow requires approval.
3. Add artifact list and execution history beyond diagnostic snapshots.
4. Add domain context configuration that can be swapped per downstream app.
5. Add tool registry UI and a first non-diagnostic tool adapter.
6. Add a first CLI/OSS-backed tool with timeout, logs, structured output, and
   artifact metadata.
7. Add generic managed-state and audit surfaces.
8. Add decision-record surfaces for provenance-backed recall.

## Design Principle

This should feel like an operator surface for serious work: dense, inspectable, and calm. Avoid turning the workbench into a marketing page or a generic chatbot wrapper.
