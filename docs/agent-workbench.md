# Agent Workbench

The workbench is the reusable frontend layer this repo is meant to become. Chat remains the first interface, but the product should support project-scale agent work: long-running processes, tools, external triggers, user knowledge, managed state, audit trails, and multi-user isolation.

Polymancer is the benchmark reference app because trading stresses autonomy, secrets, ledgers, risk, and fast external signals. The framework must stay generic: the same surfaces should support non-trading projects such as deployment agents, research assistants, document workflows, issue triage, or operations copilots.

## Core Flows

- Project context: show the active project, environment, docs, repo assumptions, and relevant constraints.
- Thread state: show whether the current thread is idle, running, interrupted, or errored.
- Run control: start, stop, retry, enqueue, and inspect runs without hiding the underlying state.
- Interrupts: surface approval prompts, missing-input requests, blocked tool calls, and external resume points.
- Artifacts: expose files, documents, plans, diffs, logs, screenshots, and generated outputs as first-class results.
- Execution history: show past runs, important events, and resumable checkpoints when the runtime supports them.
- Tools: show available tools, enabled tools, recent calls, permissions, execution policy, failures, and whether a tool is built in, project-specific, CLI-backed, or OSS-backed.
- Managed state: show what the agent owns or manages. In trading this means positions and orders; in other apps it may mean tasks, deployments, documents, tickets, or tracked resources.
- Conviction/strategy: show what the agent currently believes, why, confidence, and what would change its mind.
- Triggers: show heartbeats, webhook triggers, scheduled checks, external events, and domain-specific monitors.
- Memory/personality: let users configure durable instructions, domain knowledge, preferences, risk tolerance, tone, decision style, and operating principles.
- Decision records: show the durable "why" behind beliefs, strategies, plans, and past actions, including evidence, counter-evidence, confidence, provenance, and freshness.
- Workflow lifecycle: show where work sits in `observe`, `analyze`, `propose`, `execute`, or `review`.

## Component Rules

- Keep `components/assistant-ui/*` reusable and product-agnostic.
- Put project-specific workbench composition around the thread, not inside low-level message rendering.
- Prefer typed data passed into reusable components over global assumptions.
- Do not bake a single project domain into the base assistant experience.
- Keep trading-specific language in reference app configuration. Base components should use generic terms such as managed state, ledger, triggers, tools, memory, and risk.
- Treat tool execution as server-side only. The frontend may request, approve, inspect, or configure tools, but it must never receive provider keys, trading keys, or tool secrets.
- Treat tenant scope as runtime data, not prompt text. Every component that reads or writes durable state should receive scoped data from the server.

## Tool Implementation Requirements

- A new typed tool should be addable with a small module that declares name, description, execution function, and only the metadata proven necessary by real usage.
- CLI tools, OSS packages, scripts, and git submodules should be wrapped behind the same tool interface as native TypeScript tools.
- Tool availability should be configurable per user/workspace and per deployment.
- Tools that mutate external state must support deterministic execution modes such as ask, dry-run, and execute, with policy checks outside the model.
- Tool output should be structured enough for the UI to show results, failures, artifacts, and follow-up actions without parsing prose.

## First UI Milestones

1. Add a workbench shell around the existing thread.
2. Add a compact status surface for current thread/run state.
3. Add interrupt display and resume actions.
4. Add artifact list and execution history.
5. Add project context configuration that can be swapped per downstream app.
6. Add tool registry UI and a first typed tool demo.
7. Add a first CLI/OSS-backed tool demo with timeout, logs, and typed output.
8. Add generic managed-state and audit surfaces.
9. Add user/workspace scoping before any hosted multi-user runtime.
10. Add decision-record surfaces for provenance-backed recall.

## Design Principle

This should feel like an operator surface for serious work: dense, inspectable, and calm. Avoid turning the workbench into a marketing page or a generic chatbot wrapper.
