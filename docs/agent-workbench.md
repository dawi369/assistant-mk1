# Agent Workbench

The workbench is the reusable frontend layer this repo is meant to become. Chat remains the first interface, but the product should support project-scale agent work.

## Core Flows

- Project context: show the active project, environment, docs, repo assumptions, and relevant constraints.
- Thread state: show whether the current thread is idle, running, interrupted, or errored.
- Run control: start, stop, retry, enqueue, and inspect runs without hiding the underlying state.
- Interrupts: surface approval prompts, missing-input requests, blocked tool calls, and external resume points.
- Artifacts: expose files, documents, plans, diffs, logs, screenshots, and generated outputs as first-class results.
- Execution history: show past runs, important events, and resumable checkpoints when the runtime supports them.

## Component Rules

- Keep `components/assistant-ui/*` reusable and product-agnostic.
- Put project-specific workbench composition around the thread, not inside low-level message rendering.
- Prefer typed data passed into reusable components over global assumptions.
- Do not bake a single project domain into the base assistant experience.

## First UI Milestones

1. Add a workbench shell around the existing thread.
2. Add a compact status surface for current thread/run state.
3. Add interrupt display and resume actions.
4. Add artifact list and execution history.
5. Add project context configuration that can be swapped per downstream app.

## Design Principle

This should feel like an operator surface for serious work: dense, inspectable, and calm. Avoid turning the workbench into a marketing page or a generic chatbot wrapper.
