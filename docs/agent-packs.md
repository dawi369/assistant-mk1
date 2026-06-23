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
- checked-in code path and prompt path
- XML behavior prompt
- capability level: `template` or `single_agent_app`
- declared tools with required/default visibility/execution-mode metadata
- declared future workflow entrypoints
- UI hints for future configuration and inspectors
- risk posture for financial data, mutation, secrets, and production gates
- context hints and smoke prompts for operators

Runtime source:

- pack manifests live under `agent-packs/*`
- pack prompts are mirrored under `docs/agent-packs/*`
- Cloudflare maps packs into `agentBehaviorTemplates`
- creating an agent snapshots the resolved XML into `agents.data_json.behavior`

The production identity source remains the D1 agent snapshot after creation.
Pack file paths are authoring provenance, not runtime tenant identity.

## Examples

`agent-packs/repo-analyst.ts` defines `pack-repo-analyst`, a read-only
repository analysis agent. It declares `repo.snapshot` and `url.inspect` as
expected tools, but tool visibility and execution still flow through the normal
Cloudflare policy resolver.

`agent-packs/baby-polymancer.ts` defines `pack-baby-polymancer`, a read-only
single-agent app seed for public Polymarket market research. It declares public
market search, market snapshot, and CLOB order book snapshot tools, plus a
future LangGraph workflow intent. It does not declare trading, wallet auth,
secrets, private positions, or mutation-capable tools.

## Adding A Pack

1. Add a manifest file under `agent-packs/`.
2. Add the matching XML prompt under `docs/agent-packs/`.
3. Export the manifest from `agent-packs/index.ts`.
4. Keep the pack read-only unless the production mutation gates are satisfied.
5. Run `pnpm test:unit -- agent-behavior-templates`, `pnpm typecheck`, and
   `pnpm lint`.

Packs should express reusable agent behavior and expected capabilities. They
must not smuggle tenant scope, secrets, raw credentials, or customer-specific
policy decisions into prompt text.
