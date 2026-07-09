import type { AgentBehaviorTemplate } from "./workbench-types";

type AgentPackWorkflow = NonNullable<AgentBehaviorTemplate["pack"]>["workflows"][number];

export type PackWorkflowType = "polymancer.market_research" | "swordfish.runtime_research";

export type PackWorkflowRequest = {
  executionMode: "dry_run";
  input: Record<string, string | number | boolean>;
};

export type PackWorkflowBinding = {
  workflowType: PackWorkflowType;
  label: string;
  description: string;
  requiredPackId: "baby-polymancer" | "baby-swordfish";
  route: string;
  defaultInput: Record<string, string | number | boolean>;
  fields: Array<"query" | "symbol" | "tf" | "lookbackMinutes" | "maxBars" | "includeBars">;
};

export type PackWorkflowFieldName = PackWorkflowBinding["fields"][number];

export type PackWorkflowFieldDefinition = {
  name: PackWorkflowFieldName;
  label: string;
  description: string;
  kind: "text" | "number" | "checkbox" | "select";
  placeholder?: string;
  min?: number;
  max?: number;
  options?: Array<{ value: string; label: string }>;
};

export type ResolvedPackWorkflowBinding =
  | {
      runnable: true;
      workflow: AgentPackWorkflow;
      binding: PackWorkflowBinding;
    }
  | {
      runnable: false;
      workflow: AgentPackWorkflow;
      reason: "declared_only";
    };

const swordfishTimeframes = new Set(["1m", "5m", "15m", "30m", "1h"]);

export const packWorkflowFieldDefinitions: Record<
  PackWorkflowFieldName,
  PackWorkflowFieldDefinition
> = {
  query: {
    name: "query",
    label: "Market query",
    description: "Public Polymarket search query.",
    kind: "text",
    placeholder: "GTA",
  },
  symbol: {
    name: "symbol",
    label: "Symbol",
    description: "Optional uppercase futures symbol.",
    kind: "text",
    placeholder: "ESH6",
  },
  tf: {
    name: "tf",
    label: "Timeframe",
    description: "Bar timeframe.",
    kind: "select",
    options: Array.from(swordfishTimeframes).map((value) => ({ value, label: value })),
  },
  lookbackMinutes: {
    name: "lookbackMinutes",
    label: "Lookback",
    description: "Minutes of public bars to inspect.",
    kind: "number",
    min: 1,
    max: 1440,
  },
  maxBars: {
    name: "maxBars",
    label: "Max bars",
    description: "Maximum bars returned in the report.",
    kind: "number",
    min: 1,
    max: 200,
  },
  includeBars: {
    name: "includeBars",
    label: "Include bars",
    description: "Attach compact recent bar data.",
    kind: "checkbox",
  },
};

export const packWorkflowBindings: Record<PackWorkflowType, PackWorkflowBinding> = {
  "polymancer.market_research": {
    workflowType: "polymancer.market_research",
    label: "Market research",
    description: "Search public Polymarket markets and write a compact read-only report.",
    requiredPackId: "baby-polymancer",
    route: "/api/workbench/workflows/polymancer/market-research",
    defaultInput: { query: "GTA" },
    fields: ["query"],
  },
  "swordfish.runtime_research": {
    workflowType: "swordfish.runtime_research",
    label: "Runtime research",
    description: "Check public Swordfish runtime state and write a compact read-only report.",
    requiredPackId: "baby-swordfish",
    route: "/api/workbench/workflows/swordfish/runtime-research",
    defaultInput: {
      tf: "1m",
      lookbackMinutes: 60,
      maxBars: 25,
      includeBars: true,
    },
    fields: ["symbol", "tf", "lookbackMinutes", "maxBars", "includeBars"],
  },
};

const boundedString = (value: unknown, input: { fallback?: string; maxLength: number }) => {
  const source = typeof value === "string" ? value.trim() : "";
  const next = source || input.fallback || "";
  return next.length > input.maxLength ? next.slice(0, input.maxLength) : next;
};

const boundedInteger = (value: unknown, input: { fallback: number; min: number; max: number }) => {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  if (!Number.isInteger(parsed)) return input.fallback;
  return Math.min(input.max, Math.max(input.min, parsed));
};

const buildPolymancerRequest = (input: Record<string, unknown>): PackWorkflowRequest => ({
  executionMode: "dry_run",
  input: {
    query: boundedString(input.query, { fallback: "GTA", maxLength: 80 }),
  },
});

const buildSwordfishRequest = (input: Record<string, unknown>): PackWorkflowRequest => {
  const requestInput: PackWorkflowRequest["input"] = {
    tf: swordfishTimeframes.has(String(input.tf)) ? String(input.tf) : "1m",
    lookbackMinutes: boundedInteger(input.lookbackMinutes, {
      fallback: 60,
      min: 1,
      max: 1440,
    }),
    maxBars: boundedInteger(input.maxBars, {
      fallback: 25,
      min: 1,
      max: 200,
    }),
    includeBars: input.includeBars === false ? false : true,
  };

  const symbol = boundedString(input.symbol, { maxLength: 16 }).toUpperCase();
  if (/^[A-Z0-9._-]+$/.test(symbol)) {
    requestInput.symbol = symbol;
  }

  return {
    executionMode: "dry_run",
    input: requestInput,
  };
};

export const resolvePackWorkflowBinding = (
  workflow: AgentPackWorkflow,
): ResolvedPackWorkflowBinding => {
  const binding = packWorkflowBindings[workflow.type as PackWorkflowType];
  if (!binding) {
    return { runnable: false, workflow, reason: "declared_only" };
  }
  return { runnable: true, workflow, binding };
};

export const buildPackWorkflowRequest = (
  workflowType: string,
  input: Record<string, unknown> = {},
): PackWorkflowRequest | null => {
  if (workflowType === "polymancer.market_research") {
    return buildPolymancerRequest(input);
  }
  if (workflowType === "swordfish.runtime_research") {
    return buildSwordfishRequest(input);
  }
  return null;
};

export const fieldDefinitionsForPackWorkflow = (
  binding: Pick<PackWorkflowBinding, "fields">,
): PackWorkflowFieldDefinition[] =>
  binding.fields.map((field) => packWorkflowFieldDefinitions[field]);
