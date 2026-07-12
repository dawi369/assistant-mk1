import { defineAgentPack } from "../types";

export const babySwordfishPrompt = `<identity>
You are Swordfish Runtime, a read-only market-data operations specialist. You turn public service health, symbol snapshots, and bounded bars into a concise operational assessment with explicit freshness and integrity limits.
</identity>

<hard_boundaries>
- Read-only Swordfish runtime and market-data analysis only.
- Do not provide financial advice, investment advice, trading advice, or trade recommendations.
- Do not place trades, manage accounts, call provider APIs directly, call Massive directly, request API keys, request Railway tokens, request admin credentials, or use protected Swordfish admin endpoints.
- Do not mutate open tickers, subscriptions, caches, jobs, Redis, Postgres, Trigger.dev, Railway, or provider state.
- If the user asks for admin operations, secrets, production mutation, or trading execution, refuse that part and offer a public read-only runtime-inspection alternative.
</hard_boundaries>

<runtime_research_behavior>
- Start by identifying whether the user wants overall runtime health, a specific symbol snapshot, or recent bounded bars.
- Use only public Swordfish backend endpoints when the runtime exposes them.
- Summarize provider, Redis, durable-store, open ticker, symbol count, snapshot availability, and recent bar shape when available.
- Call out degraded service state, missing snapshots, empty bars, stale-looking data, unsupported symbols, and partial public evidence.
- Treat public market data as operational evidence, not a trading signal or recommendation.
</runtime_research_behavior>

<tool_policy>
- Expected tools are swordfish.runtime.overview, swordfish.symbol.snapshot, and swordfish.bars.range.
- These tools are dry-run/read-only workflow internals and are not directly user-invoked.
- Never construct or call Swordfish /admin routes, Railway APIs, Massive provider APIs, mutation endpoints, secrets, raw Redis, or raw SQL.
- Never include raw provider payloads, secrets, request headers, private ids, or unbounded JSON in user-facing output.
</tool_policy>

<output_style>
- Be concise, operational, and explicit about what the public data can and cannot prove.
- Use compact bullets when comparing health, snapshot, and bars evidence.
- End with a read-only next inspection step when useful.
</output_style>`;

export const babySwordfishPack = defineAgentPack({
  id: "baby-swordfish",
  name: "Swordfish Runtime",
  description: "Read-only runtime health, futures snapshots, freshness, and bar integrity.",
  profile: "analyst",
  version: "1.1.0",
  capabilityLevel: "single_agent_app",
  format: "xml",
  folderPath: "agent-packs/baby-swordfish",
  codePath: "agent-packs/baby-swordfish/index.ts",
  promptPath: "agent-packs/baby-swordfish/prompt.xml",
  tools: [
    {
      id: "swordfish.runtime.overview",
      invocation: "workflow",
      required: true,
      executionModes: ["dry_run"],
      modelVisibleDefault: false,
      purpose: "Read public Swordfish runtime health, open ticker, symbols, and snapshot count.",
    },
    {
      id: "swordfish.symbol.snapshot",
      invocation: "workflow",
      required: true,
      executionModes: ["dry_run"],
      modelVisibleDefault: false,
      purpose: "Read one public Swordfish symbol snapshot from the product backend.",
    },
    {
      id: "swordfish.bars.range",
      invocation: "workflow",
      required: true,
      executionModes: ["dry_run"],
      modelVisibleDefault: false,
      purpose: "Read a bounded public Swordfish bar range for a symbol and timeframe.",
    },
  ],
  workflows: [
    {
      type: "swordfish.runtime_research",
      engine: "cloudflare",
      status: "declared",
      userInvocable: true,
      description:
        "Cloudflare workflow for multi-step read-only Swordfish runtime and market-data reporting.",
    },
  ],
  ui: {
    primarySurface: "workbench",
    inspectorSections: ["runtime", "symbols", "bars", "tools", "risk", "history"],
    configurationMode: "code",
    welcome: {
      title: "Swordfish Runtime",
      description: "Inspect public runtime health and bounded futures data without mutations.",
      starters: [
        {
          id: "runtime-research",
          title: "Check runtime health",
          description: "Inspect services, a symbol snapshot, and recent bars.",
          action: { kind: "workflow", workflowType: "swordfish.runtime_research" },
        },
        {
          id: "snapshot-freshness",
          title: "Inspect a snapshot",
          description: "Evaluate symbol-level freshness and available evidence.",
          action: {
            kind: "message",
            prompt: "Inspect a public Swordfish symbol snapshot and assess its freshness.",
          },
        },
        {
          id: "bar-integrity",
          title: "Audit bar integrity",
          description: "Look for empty, stale, partial, or visibly gapped bars.",
          action: {
            kind: "message",
            prompt: "Audit recent bounded Swordfish bars for freshness and integrity issues.",
          },
        },
        {
          id: "data-gaps",
          title: "Review data gaps",
          description: "Separate missing, stale, and unsupported runtime evidence.",
          action: {
            kind: "message",
            prompt:
              "Review Swordfish runtime evidence and separate missing, stale, unsupported, and healthy data states.",
          },
        },
      ],
    },
  },
  risk: {
    financialData: true,
    externalMutation: false,
    requiresSecrets: false,
    productionGate: "none",
  },
  context: [
    {
      id: "swordfish.public_runtime",
      trust: "untrusted",
      description: "Public runtime health and market-data evidence from the parked adapter.",
      required: true,
      runtimeBinding: "swordfish.public",
    },
    {
      id: "runtime.history",
      trust: "trusted",
      description: "Tenant-scoped prior run evidence supplied by the workbench.",
      required: false,
      runtimeBinding: "workbench.history",
    },
  ],
  managedState: [],
  triggers: [],
  artifactRenderers: [
    {
      artifactKind: "runtime_research_report",
      renderer: "json",
      title: "Runtime research report",
      version: 1,
    },
  ],
  healthChecks: [
    {
      id: "runtime.overview.binding",
      target: { kind: "tool", id: "swordfish.runtime.overview" },
      description: "Verify that the public runtime overview adapter is registered.",
      required: true,
    },
    {
      id: "runtime.research.binding",
      target: { kind: "workflow", type: "swordfish.runtime_research" },
      description: "Verify that the bounded research workflow is registered.",
      required: true,
    },
  ],
  evals: [
    {
      id: "runtime.overview.static",
      kind: "static_smoke",
      scenarioId: "runtime-overview",
      description: "Validate the parked pack's declarations without contacting Swordfish.",
      required: true,
    },
  ],
  compatibility: { packApi: 2, minimumWorkbenchVersion: "1.0.0-preview.1" },
  resourceLimits: {
    maxRunSeconds: 30,
    maxToolCallsPerRun: 6,
    maxConcurrentRuns: 1,
    maxArtifactBytes: 131072,
  },
  smokeScenarios: [
    {
      id: "runtime-overview",
      prompt: "Inspect public Swordfish runtime health and summarize service state.",
    },
    {
      id: "symbol-snapshot",
      prompt: "Inspect one public Swordfish futures symbol snapshot.",
    },
    {
      id: "recent-bars",
      prompt: "Inspect recent bounded Swordfish bars and summarize freshness and shape.",
    },
  ],
  prompt: babySwordfishPrompt,
});
