import type { LocalAgentPackManifest } from "../types";

export const babySwordfishPrompt = `<identity>
You are Baby Swordfish, a code-first Assistant-mk1 reference agent pack for read-only Swordfish market-data runtime inspection. You help users understand the public health, live-market shape, snapshots, and bounded bar data exposed by the Swordfish product backend.
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
- These tools are dry-run/read-only and model-hidden by default in this slice.
- Never construct or call Swordfish /admin routes, Railway APIs, Massive provider APIs, mutation endpoints, secrets, raw Redis, or raw SQL.
- Never include raw provider payloads, secrets, request headers, private ids, or unbounded JSON in user-facing output.
</tool_policy>

<output_style>
- Be concise, operational, and explicit about what the public data can and cannot prove.
- Use compact bullets when comparing health, snapshot, and bars evidence.
- End with a read-only next inspection step when useful.
</output_style>`;

export const babySwordfishPack = {
  kind: "agent_pack",
  id: "baby-swordfish",
  templateId: "pack-baby-swordfish",
  name: "Baby Swordfish",
  description: "Read-only Swordfish market-data runtime inspection agent app seed.",
  profile: "analyst",
  version: "2026-06-23",
  capabilityLevel: "single_agent_app",
  format: "xml",
  folderPath: "agent-packs/baby-swordfish",
  codePath: "agent-packs/baby-swordfish/index.ts",
  promptPath: "agent-packs/baby-swordfish/prompt.xml",
  tools: [
    {
      id: "swordfish.runtime.overview",
      required: true,
      executionModes: ["dry_run"],
      modelVisibleDefault: false,
      purpose: "Read public Swordfish runtime health, open ticker, symbols, and snapshot count.",
    },
    {
      id: "swordfish.symbol.snapshot",
      required: true,
      executionModes: ["dry_run"],
      modelVisibleDefault: false,
      purpose: "Read one public Swordfish symbol snapshot from the product backend.",
    },
    {
      id: "swordfish.bars.range",
      required: true,
      executionModes: ["dry_run"],
      modelVisibleDefault: false,
      purpose: "Read a bounded public Swordfish bar range for a symbol and timeframe.",
    },
  ],
  workflows: [
    {
      type: "swordfish.runtime_research",
      engine: "langgraph",
      status: "declared",
      description:
        "Future LangGraph job for multi-step read-only Swordfish runtime and market-data reporting.",
    },
  ],
  ui: {
    primarySurface: "workbench",
    inspectorSections: ["runtime", "symbols", "bars", "tools", "risk", "history"],
    configurationMode: "code",
  },
  risk: {
    financialData: true,
    externalMutation: false,
    requiresSecrets: false,
    productionGate: "none",
  },
  context: [
    "public Swordfish runtime health",
    "public Swordfish snapshots and symbols",
    "public bounded bar data",
    "runtime history",
    "risk posture",
  ],
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
} as const satisfies LocalAgentPackManifest;
