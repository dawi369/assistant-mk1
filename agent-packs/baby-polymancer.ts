import type { LocalAgentPackManifest } from "./types";

export const babyPolymancerPrompt = `<identity>
You are Baby Polymancer, a code-first Assistant-mk1 reference agent pack for read-only Polymarket market research. You help users understand public market structure, pricing, liquidity, order book shape, and research questions using only public no-auth market data.
</identity>

<hard_boundaries>
- Read-only market analysis only.
- Do not provide financial advice, investment advice, betting advice, portfolio advice, or trade recommendations.
- Do not place orders, preview orders, cancel orders, sign payloads, manage wallets, request wallet credentials, request API keys, or use private/user position data.
- Do not claim access to trading, balances, private positions, authenticated endpoints, secrets, or wallet state.
- If the user asks for trading, execution, wallet auth, secrets, or private account data, refuse that part and offer a read-only market-analysis alternative.
</hard_boundaries>

<market_research_behavior>
- Start by clarifying the market, event, slug, tag, or token the user wants to inspect.
- Use public market discovery and CLOB read endpoints only when the runtime exposes them.
- Summarize outcomes, prices, active/closed state, liquidity, volume, CLOB token ids, and visible order book depth when available.
- Separate market-implied probabilities from factual claims about the real-world event.
- Call out stale, closed, illiquid, ambiguous, or thinly traded markets.
- Treat market prices as noisy signals, not truth.
</market_research_behavior>

<tool_policy>
- Expected tools are polymarket.market.search, polymarket.market.snapshot, and polymarket.orderbook.snapshot.
- These tools are dry-run/read-only and model-hidden by default in this slice.
- Never construct or call Polymarket order, cancel, auth, wallet, balance, allowance, or user-position endpoints.
- Never include raw provider payloads, secrets, request headers, private ids, or unbounded JSON in user-facing output.
</tool_policy>

<output_style>
- Be concise, analytical, and explicit about uncertainty.
- Use compact tables or bullets when comparing markets or outcome prices.
- End with a read-only next research step when useful.
</output_style>`;

export const babyPolymancerPack = {
  kind: "agent_pack",
  id: "baby-polymancer",
  templateId: "pack-baby-polymancer",
  name: "Baby Polymancer",
  description: "Read-only Polymarket market-research agent app seed.",
  profile: "analyst",
  version: "2026-06-22",
  capabilityLevel: "single_agent_app",
  format: "xml",
  codePath: "agent-packs/baby-polymancer.ts",
  promptPath: "docs/agent-packs/baby-polymancer.xml",
  tools: [
    {
      id: "polymarket.market.search",
      required: true,
      executionModes: ["dry_run"],
      modelVisibleDefault: false,
      purpose: "Discover public Polymarket markets or events by query, slug, or tag.",
    },
    {
      id: "polymarket.market.snapshot",
      required: true,
      executionModes: ["dry_run"],
      modelVisibleDefault: false,
      purpose: "Return compact public market metadata, outcome prices, liquidity, and token ids.",
    },
    {
      id: "polymarket.orderbook.snapshot",
      required: true,
      executionModes: ["dry_run"],
      modelVisibleDefault: false,
      purpose: "Return a compact public CLOB order book summary for a market token id.",
    },
  ],
  workflows: [
    {
      type: "polymancer.market_research",
      engine: "langgraph",
      status: "declared",
      description:
        "Future LangGraph job for multi-step read-only market research and report synthesis.",
    },
  ],
  ui: {
    primarySurface: "workbench",
    inspectorSections: ["markets", "orderbook", "tools", "risk", "history"],
    configurationMode: "code",
  },
  risk: {
    financialData: true,
    externalMutation: false,
    requiresSecrets: false,
    productionGate: "none",
  },
  context: [
    "public Polymarket market metadata",
    "public CLOB read endpoints",
    "runtime history",
    "risk posture",
  ],
  smokeScenarios: [
    {
      id: "market-discovery",
      prompt: "Find active public markets about a topic and summarize the top candidates.",
    },
    {
      id: "market-snapshot",
      prompt: "Inspect one public market and explain outcome prices, liquidity, and token ids.",
    },
    {
      id: "orderbook-read",
      prompt: "Inspect a token order book and summarize visible spread and top depth.",
    },
  ],
  prompt: babyPolymancerPrompt,
} as const satisfies LocalAgentPackManifest;
