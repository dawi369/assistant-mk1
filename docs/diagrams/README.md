# Architecture Diagrams

The repo-owned diagram brief is the source of truth. Excalidraw+ is the editable
visual artifact.

Do not reintroduce generated diagram explorers or a TypeScript graph database
for architecture diagrams. The useful invariant is smaller: keep a short,
reviewed brief in this directory, then use the Excalidraw MCP server to create
or update the matching scene.

## Current Diagrams

| Diagram                             | Brief                                                 | Excalidraw collection          | Scene                                 |
| ----------------------------------- | ----------------------------------------------------- | ------------------------------ | ------------------------------------- |
| Assistant-MK1 architecture overview | `docs/diagrams/assistant-mk1-overview.md`             | `assitant-mk1` (`AKvvdxjb2JT`) | `Assistant-MK1 Architecture Overview` |
| North-star production architecture  | `docs/diagrams/north-star-production-architecture.md` | `assitant-mk1` (`AKvvdxjb2JT`) | `North-Star Production Architecture`  |

## How To Use This

Use this workflow whenever you want to create or update an architecture diagram:

1. Decide the diagram's job. If the diagram answers a new question, create a new
   brief in this directory. If it updates an existing answer, edit that brief.
2. Read the brief's source evidence before changing the canvas. The brief should
   name the docs, code seams, and assumptions that justify the diagram.
3. Update the brief first. Change the intended boxes/arrows, acceptance
   checklist, and last-updated date before touching Excalidraw.
4. Ask Codex to update the matching Excalidraw scene via MCP. The scene should
   use editable shapes, shape-owned labels, and bound arrows.
5. Put dense rationale, source links, and ambiguity in the brief. Keep the canvas
   readable and mostly structural.
6. Run `pnpm typecheck`, a stale-reference `rg` if diagram ownership changed,
   and a scoped format check for touched docs.

The important rule: do not treat the Excalidraw scene as the only source of
truth. The scene is the visual rendering; the repo brief explains why the visual
is correct and reproducible.

## Update Workflow

1. Review the source docs and files listed in the diagram brief.
2. Update the brief first: purpose, source evidence, intended boxes/arrows, scene
   metadata, and acceptance checklist.
3. Use the Excalidraw MCP server to update the scene with editable shapes and
   bound arrows.
4. Record the scene ID and URL in the brief after the scene exists.
5. Run the narrow docs/code checks that match the change.

## Update Triggers

Review the relevant diagram brief and scene when a change alters:

- runtime boundaries between Next.js, LangGraph, Cloudflare, Fly, or provider
  services
- request flow through `/api`, external signals, threads, runs, interrupts, or
  workflow escalation
- tenant scope, policy enforcement, tool exposure, or secret custody
- durable state ownership across data-client contracts, D1, R2, Durable Objects,
  workflow checkpoints, audit records, artifacts, or run records
- deployment topology or the meaning of current versus target/planned systems

## Review Checklist

- The brief names the source docs/files used as evidence.
- The canvas separates current implementation from target/planned architecture.
- Labels use real repo/runtime names, not generic placeholders.
- Arrows show meaningful direction or ownership and stay attached to shapes.
- Dense evidence stays in the brief, not on the canvas.
- The scene remains editable Excalidraw content, not a flattened image export.
