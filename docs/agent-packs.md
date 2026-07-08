# Agent Packs

Agent packs are the code-first authoring path for Assistant-mk1 agents. A pack
is checked into the repo, reviewed like code, and compiled into the same
workspace-scoped agent behavior snapshot path as built-in templates.

Document status: v1 supports local, checked-in packs only. There is no
marketplace, upload flow, arbitrary filesystem loader, secret binding, or
customer-facing pack editor.

## Current Contract

A local pack declares:

- stable pack id and template id
- name, description, default profile, and version
- checked-in folder path, code path, and prompt path
- XML behavior prompt
- capability level: `template` or `single_agent_app`
- declared tools with required/default visibility/execution-mode metadata
- declared future workflow entrypoints
- UI hints for future configuration and inspectors
- risk posture for financial data, mutation, secrets, and production gates
- context hints and smoke prompts for operators

Runtime source:

- each pack lives under `agent-packs/<pack-id>/`
- pack manifests live in `agent-packs/<pack-id>/index.ts`
- pack prompts live beside the manifest as `agent-packs/<pack-id>/prompt.xml`
- Cloudflare maps packs into `agentBehaviorTemplates`
- creating an agent snapshots the resolved XML into `agents.data_json.behavior`
- local pack metadata, including folder path, declared tools, workflows, UI
  hints, and risk posture, is copied into the behavior snapshot
- Admin and history surfaces read pack identity from the runtime snapshot, not
  directly from the filesystem

The production identity source remains the D1 agent snapshot after creation.
Pack file paths are authoring provenance, not runtime tenant identity.

## Examples

`agent-packs/repo-analyst/index.ts` defines `pack-repo-analyst`, a read-only
repository analysis agent. It declares `repo.snapshot` and `url.inspect` as
expected tools, but tool visibility and execution still flow through the normal
Cloudflare policy resolver.

`agent-packs/baby-polymancer/index.ts` defines `pack-baby-polymancer`, a read-only
single-agent app seed for public Polymarket market research. It declares public
market search, market snapshot, and CLOB order book snapshot tools, plus a
future LangGraph workflow intent. It does not declare trading, wallet auth,
secrets, private positions, or mutation-capable tools.

`agent-packs/baby-swordfish/index.ts` defines `pack-baby-swordfish`, a read-only
single-agent app seed for public Swordfish runtime and market-data research. It
declares runtime overview, symbol snapshot, and recent bars tools, plus a future
LangGraph workflow intent. It does not declare `HUB_API_KEY`, Railway tokens,
Massive credentials, admin endpoints, direct provider access, or mutation tools.

The current Baby Polymancer workflow route is
`POST /api/workbench/workflows/polymancer/market-research`. The Cloudflare
Worker endpoint is `POST /workflows/polymancer/market-research`. It requires
the active agent to be created from `baby-polymancer`, runs public read-only
market search/snapshot/order book steps, and writes one compact market research
artifact into the normal run/history tables.

The current Baby Swordfish workflow route is
`POST /api/workbench/workflows/swordfish/runtime-research`. The Cloudflare
Worker endpoint is `POST /workflows/swordfish/runtime-research`. It requires the
active agent to be created from `baby-swordfish`, runs public read-only runtime
overview/symbol snapshot/recent bars steps, and writes one compact runtime
research artifact into the normal run/history tables.

Tool availability is pack-scoped for model exposure: a tool must be both
policy-visible and declared by the active pack before it can be exposed to the
model. Admin can still inspect globally registered tools, but each summary
marks whether the tool is declared by the active pack or only present in the
registry.

## Switching Agents

The main workbench shell exposes `/agents` as a lightweight switching surface.
Any active workspace member can choose an existing active agent. When a chat is
open, selecting another agent asks whether to continue the current thread with a
handoff marker or set the selected agent as the next blank-chat default.

Pack detail no longer lives in `/agents`. Known read-only workflow bindings
populate the `/` composer menu as active-agent slash actions, and workflow
execution stays dry-run-only in this slice. Admin remains the detailed
diagnostics/configuration surface for pack metadata, declared tools, declared
workflows, risk posture, behavior templates, and demo/test-agent creation.

## Adding A Pack

1. Add a folder under `agent-packs/<pack-id>/`.
2. Add `index.ts` and `prompt.xml` inside that folder.
3. Export the manifest from `agent-packs/index.ts`.
4. Run `pnpm agent-packs:validate`.
5. Inspect the runtime binding shape with
   `pnpm agent-packs:inspect --pack <pack-id>`.
6. Run the local pack smoke with `pnpm agent-packs:smoke --pack <pack-id>`.
7. Create or activate the pack-backed agent from Admin, then choose it from
   `/agents` in the workbench.
8. Run a declared read-only workflow from the `/` composer menu when the pack
   has a known runtime binding.
9. Inspect the resulting run and report artifact from `/history`.
10. Keep the pack read-only unless the production mutation gates are satisfied.
11. Run `pnpm test:unit -- agent-behavior-templates agent-packs`,
    `pnpm typecheck`, and `pnpm lint`.

Packs should express reusable agent behavior and expected capabilities. They
must not smuggle tenant scope, secrets, raw credentials, or customer-specific
policy decisions into prompt text.

## Developer Loop

Agent pack authoring is intentionally file-first:

```bash
pnpm agent-packs:validate
pnpm agent-packs:inspect --pack baby-polymancer
pnpm agent-packs:smoke --pack baby-polymancer
```

`agent-packs:validate` checks the local manifest contract, one-folder-per-pack
provenance, prompt parity, declared tool and workflow ids, risk posture, and
smoke scenario metadata. Use `--json` when wiring this into CI or another
automation.

`agent-packs:inspect --pack <pack-id>` prints the customer-facing pack identity
plus runtime binding status. Tool bindings are checked against the Cloudflare
tool policy catalog. Workflow bindings are checked against the known
Worker/Vercel route map. Missing bindings are reported as warnings so a
developer can declare future workflows before implementing them.

`agent-packs:smoke --pack <pack-id>` stays local in v1. It verifies that the
pack maps into behavior templates and that agent creation would snapshot the
same pack prompt and provenance. If a pack has a known live read-only smoke,
the command prints the exact optional command instead of calling external
services automatically.

After local validation, use `/agents` to choose the pack-backed agent and use
the `/` composer menu to run its declared read-only workflow when a binding is
available. Slash workflow actions only call known same-origin workflow bindings,
always send `executionMode: "dry_run"`, and link the resulting run back to
`/history`.

## Golden Pack Checklist

- One folder per agent under `agent-packs/<pack-id>/`.
- `index.ts` contains the manifest and `prompt.xml` mirrors the manifest prompt.
- Prompt includes an `<identity>` section and no inline secrets or credentials.
- Declared tools have stable ids, purposes, and allowed execution modes.
- Declared workflows have stable intent types and future route bindings when
  implemented.
- Risk posture is explicit: financial data, mutation, secrets, and production
  gate.
- Smoke scenarios describe the first local checks an operator or developer
  should run.
- UI hints keep future UI authoring possible, but code/files remain the source
  of truth in this slice.
