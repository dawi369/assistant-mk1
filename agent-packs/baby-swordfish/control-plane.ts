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
  packId: "baby-swordfish",
  runtimeVersion: "1.0.0",
  compatiblePackVersions: "^1.1.0",
  tools: ["swordfish.runtime.overview", "swordfish.symbol.snapshot", "swordfish.bars.range"].map(
    (id) => ({
      id,
      description: "Read bounded data from the parked Swordfish facade.",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      executionModes: ["dry_run"] as const,
      transport: "cloudflare_inline" as const,
      adapterVersion: `${id}-v1`,
      timeoutMs: 8_000,
      maxArtifactBytes: 65_536,
      policy: readonlyPolicy("swordfish-readonly-v0"),
    }),
  ),
  workflows: [
    {
      type: "swordfish.runtime_research",
      engine: "cloudflare",
      label: "Runtime research",
      description: "Inspect the parked Swordfish read-only facade.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          symbol: { type: "string", maxLength: 16 },
          tf: { type: "string", enum: ["1m", "5m", "15m", "30m", "1h"], default: "1m" },
          lookbackMinutes: { type: "integer", minimum: 1, maximum: 1440, default: 60 },
          maxBars: { type: "integer", minimum: 1, maximum: 200, default: 25 },
          includeBars: { type: "boolean", default: true },
        },
      },
      outputSchema: { type: "object" },
      form: [
        {
          name: "symbol",
          label: "Symbol",
          description: "Optional uppercase futures symbol.",
          kind: "text",
          placeholder: "ESH6",
        },
        {
          name: "tf",
          label: "Timeframe",
          description: "Bar timeframe.",
          kind: "select",
          options: ["1m", "5m", "15m", "30m", "1h"].map((value) => ({ value, label: value })),
        },
        {
          name: "lookbackMinutes",
          label: "Lookback",
          description: "Minutes of public bars to inspect.",
          kind: "number",
          min: 1,
          max: 1440,
        },
        {
          name: "maxBars",
          label: "Max bars",
          description: "Maximum bars returned in the report.",
          kind: "number",
          min: 1,
          max: 200,
        },
        {
          name: "includeBars",
          label: "Include bars",
          description: "Attach compact recent bar data.",
          kind: "checkbox",
        },
      ],
      toolIds: ["swordfish.runtime.overview", "swordfish.symbol.snapshot", "swordfish.bars.range"],
      cancellation: { adapter: "none", physicalAbort: "unsupported" },
      smokeCommand: "pnpm smoke:swordfish-readonly",
      normalizeInput: (input) => {
        const integer = (value: unknown, fallback: number, min: number, max: number) => {
          const parsed =
            typeof value === "number"
              ? value
              : typeof value === "string" && value.trim()
                ? Number(value)
                : Number.NaN;
          return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
        };
        const result: Record<string, string | number | boolean> = {
          tf: ["1m", "5m", "15m", "30m", "1h"].includes(String(input.tf)) ? String(input.tf) : "1m",
          lookbackMinutes: integer(input.lookbackMinutes, 60, 1, 1440),
          maxBars: integer(input.maxBars, 25, 1, 200),
          includeBars: input.includeBars !== false,
        };
        const symbol = typeof input.symbol === "string" ? input.symbol.trim().toUpperCase() : "";
        if (/^[A-Z0-9._-]+$/.test(symbol)) result.symbol = symbol.slice(0, 16);
        return result;
      },
    },
  ],
  health: [
    {
      id: "runtime.overview.binding",
      required: true,
      check: () => ({ ok: true, summary: "Swordfish remains packaged and parked." }),
    },
    {
      id: "runtime.research.binding",
      required: true,
      check: () => ({ ok: true, summary: "Swordfish workflow remains parked." }),
    },
  ],
  evals: [
    {
      id: "runtime.overview.static",
      required: true,
      run: () => ({ ok: true, summary: "Parked Swordfish static contract compiled." }),
    },
  ],
});
