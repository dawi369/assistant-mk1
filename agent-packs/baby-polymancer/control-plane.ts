import { defineControlPlaneModule } from "@assistant-mk1/agent-sdk/control-plane";

const readonlyPolicy = (reference: string) => ({
  reference,
  adminVisible: true,
  modelVisible: false,
  requiresApproval: false,
  policyEditable: true,
  mutationRisk: "read_only" as const,
});

export const controlPlane = defineControlPlaneModule({
  packId: "baby-polymancer",
  runtimeVersion: "1.0.0",
  compatiblePackVersions: "^1.1.0",
  tools: [
    {
      id: "polymarket.market.search",
      description: "Search bounded public Polymarket metadata.",
      inputSchema: {
        type: "object",
        required: ["query"],
        additionalProperties: false,
        properties: { query: { type: "string", minLength: 1, maxLength: 80 } },
      },
      outputSchema: { type: "object" },
      executionModes: ["dry_run"],
      transport: "cloudflare_inline",
      adapterVersion: "polymarket-market-search-v1",
      timeoutMs: 8_000,
      maxArtifactBytes: 65_536,
      policy: readonlyPolicy("polymarket-readonly-v0"),
    },
    {
      id: "polymarket.market.snapshot",
      description: "Read bounded public market metadata.",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      executionModes: ["dry_run"],
      transport: "cloudflare_inline",
      adapterVersion: "polymarket-market-snapshot-v1",
      timeoutMs: 8_000,
      maxArtifactBytes: 65_536,
      policy: readonlyPolicy("polymarket-readonly-v0"),
    },
    {
      id: "polymarket.orderbook.snapshot",
      description: "Read a bounded public order-book snapshot.",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      executionModes: ["dry_run"],
      transport: "cloudflare_inline",
      adapterVersion: "polymarket-orderbook-snapshot-v1",
      timeoutMs: 8_000,
      maxArtifactBytes: 65_536,
      policy: readonlyPolicy("polymarket-readonly-v0"),
    },
  ],
  workflows: [
    {
      type: "polymancer.market_research",
      engine: "cloudflare",
      label: "Market research",
      description: "Search public Polymarket markets and write a compact report.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: { query: { type: "string", minLength: 1, maxLength: 80, default: "GTA" } },
      },
      outputSchema: { type: "object" },
      form: [
        {
          name: "query",
          label: "Market query",
          description: "Public Polymarket search query.",
          kind: "text",
          placeholder: "GTA",
        },
      ],
      toolIds: [
        "polymarket.market.search",
        "polymarket.market.snapshot",
        "polymarket.orderbook.snapshot",
      ],
      cancellation: { adapter: "none", physicalAbort: "unsupported" },
      smokeCommand: "pnpm smoke:polymarket-readonly",
      normalizeInput: (input) => {
        const query = typeof input.query === "string" ? input.query.trim() : "";
        return { query: (query || "GTA").slice(0, 80) };
      },
    },
  ],
  health: [
    {
      id: "market.search.binding",
      required: true,
      check: () => ({ ok: true, summary: "Market research bindings compiled." }),
    },
    {
      id: "market.research.binding",
      required: true,
      check: () => ({ ok: true, summary: "Market research workflow compiled." }),
    },
  ],
  evals: [
    {
      id: "market.discovery.static",
      required: true,
      run: () => ({ ok: true, summary: "Polymancer static contract compiled." }),
    },
  ],
});
