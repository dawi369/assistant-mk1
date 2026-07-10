# Agent Packs

Agent Packs are the code-first extension boundary for Assistant-mk1. A pack
bundles reviewed behavior, declared tools and workflows, user-facing starters,
risk metadata, and verification scenarios. Creating an agent snapshots the
installed pack version into the workspace-scoped D1 agent record.

Document status: Agent Pack API v1 is implemented for trusted, checked-in
packs. Remote installation, a marketplace, arbitrary executable uploads,
secret binding, and automatic snapshot upgrades are not implemented.

## Contract

Define a pack with `defineAgentPack()`:

```ts
export const examplePack = defineAgentPack({
  id: "example-analyst",
  name: "Example Analyst",
  description: "Bounded analysis over trusted read-only tools.",
  profile: "analyst",
  version: "1.0.0",
  capabilityLevel: "single_agent_app",
  format: "xml",
  folderPath: "agent-packs/example-analyst",
  codePath: "agent-packs/example-analyst/index.ts",
  promptPath: "agent-packs/example-analyst/prompt.xml",
  tools: [],
  workflows: [],
  ui: {
    primarySurface: "workbench",
    inspectorSections: ["prompt", "tools", "history"],
    configurationMode: "code",
    welcome: {
      title: "Example Analyst",
      description: "Choose a focused starting point.",
      starters: [
        /* exactly three message or workflow actions */
      ],
    },
  },
  risk: {
    financialData: false,
    externalMutation: false,
    requiresSecrets: false,
    productionGate: "none",
  },
  context: [],
  smokeScenarios: [],
  prompt: examplePrompt,
});
```

`defineAgentPack()` adds `apiVersion: 1`, `kind: "agent_pack"`, and the derived
template id `pack-<id>`. Versions must be semantic. The adjacent `prompt.xml`
must match the inline prompt exactly.

Pack definitions may declare capabilities but cannot implement trusted runtime
code. The shared workflow catalog owns bounded forms, input normalization,
same-origin and Worker routes, artifact kinds, and smoke commands. The Worker
handler registry is exhaustive over runnable catalog entries.

## Bundled Packs

| Product name        | Stable pack id    | Workflow                     | Artifact kind             |
| ------------------- | ----------------- | ---------------------------- | ------------------------- |
| Repository Analyst  | `repo-analyst`    | `repo.readiness_report`      | `repo_readiness_report`   |
| Polymancer Research | `baby-polymancer` | `polymancer.market_research` | `market_research_report`  |
| Swordfish Runtime   | `baby-swordfish`  | `swordfish.runtime_research` | `runtime_research_report` |

Repository Analyst calls the signed Fly `repo.snapshot` adapter and produces a
bounded repository-readiness report. Polymancer Research uses public no-auth
Polymarket discovery, snapshot, and CLOB reads. Swordfish Runtime uses only the
public Swordfish health, snapshot, and bounded-bars endpoints. All three are
read-only and persist their workflow, tool-call, audit, event, and artifact
metadata through the common Cloudflare lifecycle.

## Versioning And Activation

Pack-backed agents are immutable snapshots:

- Existing agents keep their prompt, pack metadata, and version.
- Updating a checked-in pack does not silently update an agent.
- Admin **Use pack** reuses an active agent only when pack id and version match.
- Otherwise Cloudflare creates one deterministic managed instance for that
  workspace, pack, and version using an idempotent insert.
- Activation starts a fresh chat and leaves the current thread unchanged.

The Vercel activation facade requires the operator allowlist. Cloudflare also
requires active workspace `owner` or `admin` membership. `/agents` remains the
normal member-facing switcher for existing agents.

## Welcome Actions

The active pack snapshot supplies the empty-chat title, description, and three
starter actions. Message actions use the normal optimistic composer path.
Workflow actions open the existing bounded workflow dialog. Cached session
metadata renders these immediately while the live Worker connection completes
in the background. Legacy and non-pack agents use the generic welcome.

## Adding A Pack

1. Add `agent-packs/<pack-id>/index.ts` and `prompt.xml`.
2. Define the manifest with `defineAgentPack()` and export it from the pack
   index.
3. Register the pack in `agent-packs/index.ts`.
4. If it has a runnable workflow, add one shared workflow-catalog descriptor
   and one exhaustive Worker handler.
5. Add report-derivation, authorization, retry, artifact-preview, and input
   bound tests.
6. Run:

```bash
pnpm agent-packs:validate
pnpm agent-packs:inspect --pack <pack-id>
pnpm agent-packs:smoke --pack <pack-id>
pnpm verify:fast
```

Use `--json` on the pack scripts when integrating them into automation. Live
provider smokes remain explicit and are never triggered by local validation.

## Safety Rules

- Never put tenant ids, credentials, private endpoints, provider headers, or
  customer-specific policy in a pack.
- Declaring a tool does not make it model-visible. Cloudflare policy and active
  pack scope must both allow exposure.
- Secret-requiring packs fail v1 validation.
- Execute-mode tools require mutation risk and a production gate.
- Missing runtime workflow bindings remain visible as declared-only and cannot
  execute.
- Pack results belong in `/history`; raw implementation details belong in the
  allowlisted Admin Diagnostics tab.
