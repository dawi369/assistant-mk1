export type PackWorkflowRequest = {
  executionMode: "dry_run";
  input: Record<string, string | number | boolean>;
};

export type PackWorkflowFieldName =
  | "query"
  | "symbol"
  | "tf"
  | "lookbackMinutes"
  | "maxBars"
  | "includeBars"
  | "includeDocs"
  | "includeScripts"
  | "includeConfig";

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

export type PackWorkflowBinding = {
  workflowType: string;
  label: string;
  description: string;
  requiredPackId: string;
  workerRoute: string;
  route: string;
  artifactKind: string;
  smokeCommand: string;
  defaultInput: Record<string, string | number | boolean>;
  fields: PackWorkflowFieldName[];
  buildRequest: (input: Record<string, unknown>) => PackWorkflowRequest;
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

const swordfishTimeframes = ["1m", "5m", "15m", "30m", "1h"] as const;
const swordfishTimeframeSet = new Set<string>(swordfishTimeframes);

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
    options: swordfishTimeframes.map((value) => ({ value, label: value })),
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
  includeDocs: {
    name: "includeDocs",
    label: "Documentation",
    description: "Include the bounded documentation inventory.",
    kind: "checkbox",
  },
  includeScripts: {
    name: "includeScripts",
    label: "Scripts",
    description: "Include package scripts and verification commands.",
    kind: "checkbox",
  },
  includeConfig: {
    name: "includeConfig",
    label: "Configuration",
    description: "Include bounded configuration-file evidence.",
    kind: "checkbox",
  },
};

const buildRepoReadinessRequest = (input: Record<string, unknown>): PackWorkflowRequest => ({
  executionMode: "dry_run",
  input: {
    includeDocs: input.includeDocs !== false,
    includeScripts: input.includeScripts !== false,
    includeConfig: input.includeConfig !== false,
  },
});

const buildPolymancerRequest = (input: Record<string, unknown>): PackWorkflowRequest => ({
  executionMode: "dry_run",
  input: { query: boundedString(input.query, { fallback: "GTA", maxLength: 80 }) },
});

const buildSwordfishRequest = (input: Record<string, unknown>): PackWorkflowRequest => {
  const requestInput: PackWorkflowRequest["input"] = {
    tf: swordfishTimeframeSet.has(String(input.tf)) ? String(input.tf) : "1m",
    lookbackMinutes: boundedInteger(input.lookbackMinutes, {
      fallback: 60,
      min: 1,
      max: 1440,
    }),
    maxBars: boundedInteger(input.maxBars, { fallback: 25, min: 1, max: 200 }),
    includeBars: input.includeBars !== false,
  };
  const symbol = boundedString(input.symbol, { maxLength: 16 }).toUpperCase();
  if (/^[A-Z0-9._-]+$/.test(symbol)) requestInput.symbol = symbol;
  return { executionMode: "dry_run", input: requestInput };
};

export const packWorkflowBindings = {
  "repo.readiness_report": {
    workflowType: "repo.readiness_report",
    label: "Readiness report",
    description: "Inspect repository structure and produce a bounded release-readiness report.",
    requiredPackId: "repo-analyst",
    workerRoute: "/workflows/repo/readiness-report",
    route: "/api/workbench/workflows/repo/readiness-report",
    artifactKind: "repo_readiness_report",
    smokeCommand: "pnpm smoke:fly-tool-runner",
    defaultInput: { includeDocs: true, includeScripts: true, includeConfig: true },
    fields: ["includeDocs", "includeScripts", "includeConfig"],
    buildRequest: buildRepoReadinessRequest,
  },
  "polymancer.market_research": {
    workflowType: "polymancer.market_research",
    label: "Market research",
    description: "Search public Polymarket markets and write a compact read-only report.",
    requiredPackId: "baby-polymancer",
    workerRoute: "/workflows/polymancer/market-research",
    route: "/api/workbench/workflows/polymancer/market-research",
    artifactKind: "market_research_report",
    smokeCommand: "pnpm smoke:polymarket-readonly",
    defaultInput: { query: "GTA" },
    fields: ["query"],
    buildRequest: buildPolymancerRequest,
  },
  "swordfish.runtime_research": {
    workflowType: "swordfish.runtime_research",
    label: "Runtime research",
    description: "Check public Swordfish runtime state and write a compact read-only report.",
    requiredPackId: "baby-swordfish",
    workerRoute: "/workflows/swordfish/runtime-research",
    route: "/api/workbench/workflows/swordfish/runtime-research",
    artifactKind: "runtime_research_report",
    smokeCommand: "pnpm smoke:swordfish-readonly",
    defaultInput: { tf: "1m", lookbackMinutes: 60, maxBars: 25, includeBars: true },
    fields: ["symbol", "tf", "lookbackMinutes", "maxBars", "includeBars"],
    buildRequest: buildSwordfishRequest,
  },
} as const satisfies Record<string, PackWorkflowBinding>;

export type PackWorkflowType = keyof typeof packWorkflowBindings;

export const buildPackWorkflowRequest = (
  workflowType: string,
  input: Record<string, unknown> = {},
): PackWorkflowRequest | null => {
  const binding = packWorkflowBindings[workflowType as PackWorkflowType];
  return binding ? binding.buildRequest(input) : null;
};

export const fieldDefinitionsForPackWorkflow = (
  binding: Pick<PackWorkflowBinding, "fields">,
): PackWorkflowFieldDefinition[] =>
  binding.fields.map((field) => packWorkflowFieldDefinitions[field]);
