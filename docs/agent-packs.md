# Agent Packs

Agent Packs are the code-first extension boundary for Assistant-mk1. A pack
bundles reviewed behavior, declared tools and workflows, user-facing starters,
risk metadata, and verification scenarios. Creating an agent snapshots the
installed pack version into the workspace-scoped D1 agent record.

The complete target composition boundary is defined in
`capability-model.md`. API v1 intentionally implements only the subset that can
be validated and enforced today.

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
  version: "1.1.0",
  capabilityLevel: "single_agent_app",
  format: "xml",
  folderPath: "agent-packs/example-analyst",
  codePath: "agent-packs/example-analyst/index.ts",
  promptPath: "agent-packs/example-analyst/prompt.xml",
  tools: [
    {
      id: "example.lookup",
      invocation: "workflow",
      required: true,
      executionModes: ["dry_run"],
      modelVisibleDefault: false,
      purpose: "Return bounded evidence for the example workflow.",
    },
  ],
  workflows: [
    {
      type: "example.research",
      engine: "langgraph",
      status: "declared",
      userInvocable: true,
      description: "Run bounded example research.",
    },
  ],
  ui: {
    primarySurface: "workbench",
    inspectorSections: ["prompt", "tools", "history"],
    configurationMode: "code",
    welcome: {
      title: "Example Analyst",
      description: "Choose a focused starting point.",
      starters: [
        /* exactly two or four message or workflow actions */
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

Each tool declares who invokes it:

- `user`: a direct tool exposed to the operator surface.
- `agent`: a conversational tool the model may select when policy allows it.
- `workflow`: an internal adapter used only inside a bounded workflow.

Workflows remain separate, explicit user actions. The normal **Tools** panel and
`/tools` command show runnable workflow launchers, agent-only tools, and
workflow-internal adapters for the current agent without conflating them.

## Target Composition

Future pack versions may declare context sources, managed-state and decision
extensions, artifact renderers, triggers, connection requirements, policy
defaults, budgets, evals, health checks, migrations, and compatibility bounds.
Those declarations remain inert until trusted platform code registers the
runtime binding and workspace policy allows it. Pack installation never grants
credentials, model exposure, trigger authority, or mutation rights.

Pack-owned descriptors compose into generic workbench surfaces. They do not add
unscoped routes, arbitrary executable uploads, domain tables, or private
navigation forks. State uses namespaced extension data until a repeated shape
earns a shared platform contract.

## Bundled Packs

| Product name        | Stable pack id    | Workflow                     | Artifact kind             |
| ------------------- | ----------------- | ---------------------------- | ------------------------- |
| Repository Analyst  | `repo-analyst`    | `repo.readiness_report`      | `repo_readiness_report`   |
| Polymancer Research | `baby-polymancer` | `polymancer.market_research` | `market_research_report`  |
| Swordfish Runtime   | `baby-swordfish`  | `swordfish.runtime_research` | `runtime_research_report` |

Repository Analyst calls the signed Fly `repo.snapshot` adapter and produces a
bounded repository-readiness report. Polymancer Research uses public no-auth
Polymarket discovery, snapshot, and CLOB reads. Swordfish Runtime preserves a
bounded public-health/snapshot/bars reference contract, but its backend is
intentionally parked and may return `404`; it is not a live release smoke.
Runnable pack workflows persist workflow, tool-call, audit, event, and artifact
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

The active pack snapshot supplies the empty-chat title, description, and either
two or four starter actions so the grid never renders an orphaned card. Message
actions use the normal optimistic composer path.
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
- A tool's invocation class is descriptive, not an authorization bypass. User,
  agent, and workflow calls still require a registered runtime binding and
  Cloudflare policy approval.
- Secret-requiring packs fail v1 validation.
- Execute-mode tools require mutation risk and a production gate.
- Missing runtime workflow bindings remain visible as declared-only and cannot
  execute.
- Pack results belong in `/history`; raw implementation details belong in the
  allowlisted Admin Diagnostics tab.
