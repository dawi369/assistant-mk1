# Agent Workbench

The workbench is the reusable frontend layer this repo is meant to become. Chat remains the first interface, but the product should support project-scale agent work: long-running processes, tools, external triggers, user knowledge, managed state, audit trails, and multi-user isolation.

Polymancer, deployment agents, and the Personal Job Agent are benchmark
reference apps because they stress autonomy, secrets, ledgers, execution
policy, browser automation, and fast external signals. The framework must stay
generic: the same surfaces should support research assistants, document
workflows, issue triage, operations copilots, and other agent projects.

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
existing top-right drawer and demo.inspect diagnostic action. The current
drawer is flow-first: it leads with chat readiness, active workspace, active
agent/profile, latest meaningful event, and the important error. Workspace and
agent management remain available as secondary controls, while raw ids, recent
events, and external WorkOS signals stay in advanced details.

Thread history v0 is the active normal-chat polish slice. It should be
assistant-ui-native: use the remote thread-list runtime and thread-list
primitives for recent chats, new chat, and thread switching while Cloudflare D1
owns thread rows, ownership checks, and active-thread state. The first version
is intentionally limited to list, switch, and new chat for the resolved
user/workspace/active agent. Archive, delete, rename, generated titles, search,
shared threads, and mobile-specific history polish are future slices.

Chat responsiveness and observability v0 keeps the normal assistant-ui surface
unchanged while making runtime status feel immediate. The compact hint may use
assistant-ui local lifecycle state for transient `Running` feedback, but
workspace, agent, thread, run, error, and timing truth still comes from
Cloudflare. Cloudflare stores simple-chat timing metadata on chat runs so Dev
Monitor can show first-token and total runtime without routing small chats
through Fly/LangGraph.

Workspace management v0 is the current Dev Monitor-only slice: list workspaces
for the current WorkOS account, create a name-only workspace, and switch the
active workspace through Cloudflare. This is not a customer-facing workspace
product yet; it is the operator view needed before workspace invites, role
policy, agent routing, or deeper chat debugging.

Agent routing v0 keeps agents workspace-scoped and Cloudflare-owned. Dev
Monitor can create test agents for the active workspace, switch the current
user's active agent preference, and show the active agent/profile used by chat
runtime records. This is still not a customer-facing generic agent builder:
client workspaces get production agents configured during integration work, and
apps like Polymancer can later provision isolated agents per user or workspace
without moving scope selection into the browser.

Agent behavior v0 makes those workspace-scoped agents affect the Cloudflare
simple-chat system prompt. Behavior templates live in `docs/prompts` as seed
material, using `docs/prompts/poke.xml` only as a structural and tonal
reference. The active behavior for a created agent is a D1 snapshot stored in
`agents.data_json.behavior`, so D1 remains the runtime source of truth after
provisioning. Dev Monitor can import a template into a new agent and preview
the active XML prompt, but full editing, version history, approvals, and a
customer-facing agent builder remain future slices.

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
   workspace-scoped agent list, Dev Monitor-only test agent creation, and
   Cloudflare-owned active-agent preference.
5. Agent behavior: make agent profiles affect runtime behavior through
   Cloudflare-owned prompt snapshots. In v0, Dev Monitor imports XML templates
   into D1-backed agent behavior and Cloudflare injects the active snapshot.
6. More Cloudflare ownership: move context, policy, audit, events, run state,
   tool authorization, and eventually secret access behind Cloudflare APIs. The
   active v0 slice is a Cloudflare-owned chat runtime summary shown in Dev
   Monitor.
7. Stronger Vercel-to-Cloudflare trust boundary: replace loose trusted headers
   with a stricter signed or service-authenticated server contract.
8. WorkOS organization UX: handle org switching, personal fallback, onboarding,
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
- Assistant-ui-native thread history is being added as the next normal-chat
  surface: a compact recent-chats list around the thread, backed by
  Cloudflare-owned thread metadata.
- Chat runtime responsiveness is being improved with assistant-ui-native local
  run state, quieter admin-summary refreshes, and Cloudflare-owned timing
  metadata for first-token and total runtime.
- Dev Monitor provides Cloudflare-derived admin/runtime visibility with a
  flow-first chat overview and secondary workspace/agent controls.
- Dev Monitor can create template-backed agents and preview the active XML
  behavior snapshot stored in D1.
- The normal chat shell has a compact server-derived runtime hint for active
  workspace, active agent/profile, chat state, and error detail access.
- WorkOS, workspace, membership, and active agent scope are server-derived.
- The first typed diagnostic tool path exists through `demo.inspect`.

Next milestones:

1. Finish chat responsiveness and timing observability so the normal shell
   reflects active runs immediately and Dev Monitor can explain latency.
2. Finish recent chat history polish: list, switch, and new chat through
   assistant-ui thread-list primitives, with Cloudflare-owned authorization.
3. Expand agent behavior from template import/preview into full editing,
   version history, approvals, and tool-specific configuration.
4. Add interrupt display and resume actions when a workflow requires approval.
5. Add artifact list and execution history beyond diagnostic snapshots.
6. Add domain context configuration that can be swapped per downstream app.
7. Add tool registry UI and a first non-diagnostic tool adapter.
8. Add a first CLI/OSS-backed tool with timeout, logs, structured output, and
   artifact metadata.
9. Add generic managed-state and audit surfaces.
10. Add decision-record surfaces for provenance-backed recall.

## Design Principle

This should feel like an operator surface for serious work: dense, inspectable, and calm. Avoid turning the workbench into a marketing page or a generic chatbot wrapper.
