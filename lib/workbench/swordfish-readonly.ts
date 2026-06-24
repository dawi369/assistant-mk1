export const swordfishRuntimeOverviewToolName = "swordfish.runtime.overview";
export const swordfishSymbolSnapshotToolName = "swordfish.symbol.snapshot";
export const swordfishBarsRangeToolName = "swordfish.bars.range";
export const swordfishReadonlyPolicy = "swordfish-readonly-v0";
export const swordfishReadonlyAdapterVersion = "swordfish-readonly-v1";

export const swordfishReadonlyToolNames = [
  swordfishRuntimeOverviewToolName,
  swordfishSymbolSnapshotToolName,
  swordfishBarsRangeToolName,
] as const;

export type SwordfishReadonlyToolName = (typeof swordfishReadonlyToolNames)[number];

export type SwordfishReadonlyError = {
  code: "invalid_input" | "provider_request_failed" | "provider_response_invalid";
  message: string;
  retryable: boolean;
  redacted: true;
};

export type SwordfishRuntimeOverviewInput = Record<string, never>;

export type SwordfishSymbolSnapshotInput = {
  symbol: string;
};

export type SwordfishBarsRangeInput = {
  symbol: string;
  tf: "1m" | "5m" | "15m" | "30m" | "1h";
  lookbackMinutes: number;
  endMs?: number;
  maxBars: number;
};

type ServiceStatus = "connected" | "disconnected" | "disabled" | string;

export type SwordfishRuntimeOverviewOutput = {
  status: "ok";
  summary: string;
  source: "swordfish_public";
  backendBaseUrl: typeof swordfishBackendBaseUrl;
  health: {
    status?: string;
    timestamp?: number;
    services: {
      redis?: ServiceStatus;
      timescaledb?: ServiceStatus;
      massiveWs?: ServiceStatus;
    };
  };
  openTicker?: string | null;
  symbolCount?: number;
  sampleSymbols: string[];
  snapshotCount?: number;
  timingMs: number;
};

export type SwordfishSymbolSnapshotOutput = {
  status: "ok";
  summary: string;
  source: "swordfish_public";
  symbol: string;
  snapshot: {
    ticker?: string;
    productCode?: string;
    name?: string;
    timestamp?: number;
    lastPrice?: number | string;
    change?: number | string;
    changePercent?: number | string;
    settlementPrice?: number | string;
    prevSettlement?: number | string;
    openInterest?: number | string;
    volume?: number | string;
    settlementDate?: string;
  };
  timingMs: number;
};

export type SwordfishBarsRangeOutput = {
  status: "ok";
  summary: string;
  source: "swordfish_public";
  symbol: string;
  tf: SwordfishBarsRangeInput["tf"];
  start: number;
  end: number;
  count: number;
  returnedBars: number;
  dataSource?: string;
  bars: Array<{
    ts?: number | string;
    open?: number;
    high?: number;
    low?: number;
    close?: number;
    volume?: number;
    trades?: number;
    source?: string;
  }>;
  timingMs: number;
};

export type SwordfishReadonlyOutput =
  | SwordfishRuntimeOverviewOutput
  | SwordfishSymbolSnapshotOutput
  | SwordfishBarsRangeOutput;

export type SwordfishReadonlyResult =
  | { ok: true; output: SwordfishReadonlyOutput }
  | { ok: false; error: SwordfishReadonlyError };

export type SwordfishRuntimeOverviewResult =
  | { ok: true; output: SwordfishRuntimeOverviewOutput }
  | { ok: false; error: SwordfishReadonlyError };

export type SwordfishSymbolSnapshotResult =
  | { ok: true; output: SwordfishSymbolSnapshotOutput }
  | { ok: false; error: SwordfishReadonlyError };

export type SwordfishBarsRangeResult =
  | { ok: true; output: SwordfishBarsRangeOutput }
  | { ok: false; error: SwordfishReadonlyError };

export const swordfishBackendBaseUrl = "https://swordfish-backend-production.up.railway.app";

const maxProviderResponseBytes = 512 * 1024;
const providerTimeoutMs = 8_000;

const supportedInputKeys = {
  [swordfishRuntimeOverviewToolName]: new Set<string>(),
  [swordfishSymbolSnapshotToolName]: new Set(["symbol"]),
  [swordfishBarsRangeToolName]: new Set(["symbol", "tf", "lookbackMinutes", "endMs", "maxBars"]),
};

const forbiddenInputKeys = new Set([
  "url",
  "endpoint",
  "host",
  "headers",
  "authorization",
  "token",
  "secret",
  "password",
  "apiKey",
  "api_key",
  "privateKey",
  "railwayToken",
  "hubApiKey",
  "admin",
  "adminPath",
  "method",
  "body",
]);

const allowedTimeframes = new Set<SwordfishBarsRangeInput["tf"]>(["1m", "5m", "15m", "30m", "1h"]);

export const swordfishReadonlyError = (
  code: SwordfishReadonlyError["code"],
  message: string,
  retryable = false,
): SwordfishReadonlyError => ({ code, message, retryable, redacted: true });

export const isSwordfishReadonlyToolName = (value: string): value is SwordfishReadonlyToolName =>
  swordfishReadonlyToolNames.includes(value as SwordfishReadonlyToolName);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isSwordfishError = (value: unknown): value is SwordfishReadonlyError =>
  isRecord(value) && value.redacted === true && typeof value.code === "string";

const readInputRecord = (
  toolName: SwordfishReadonlyToolName,
  input: unknown,
): Record<string, unknown> | SwordfishReadonlyError => {
  const source = input === undefined ? {} : input;
  if (!isRecord(source)) {
    return swordfishReadonlyError("invalid_input", `${toolName} input must be an object.`);
  }
  const supported = supportedInputKeys[toolName];
  for (const key of Object.keys(source)) {
    if (forbiddenInputKeys.has(key) || !supported.has(key)) {
      return swordfishReadonlyError("invalid_input", `${key} is not supported by ${toolName}.`);
    }
  }
  return source;
};

const readSymbol = (value: unknown) => {
  if (typeof value !== "string") {
    return swordfishReadonlyError("invalid_input", "symbol must be a string.");
  }
  const symbol = value.trim().toUpperCase();
  if (!symbol) return swordfishReadonlyError("invalid_input", "symbol is required.");
  if (symbol.length > 16 || !/^[A-Z0-9._-]+$/.test(symbol)) {
    return swordfishReadonlyError("invalid_input", "symbol contains unsupported characters.");
  }
  return symbol;
};

const readTimeframe = (value: unknown) => {
  if (value === undefined) return "1m" as const;
  if (typeof value !== "string" || !allowedTimeframes.has(value as SwordfishBarsRangeInput["tf"])) {
    return swordfishReadonlyError("invalid_input", "tf must be one of 1m, 5m, 15m, 30m, or 1h.");
  }
  return value as SwordfishBarsRangeInput["tf"];
};

const readInteger = (
  value: unknown,
  input: { field: string; fallback: number; min: number; max: number },
) => {
  if (value === undefined) return input.fallback;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < input.min ||
    value > input.max
  ) {
    return swordfishReadonlyError(
      "invalid_input",
      `${input.field} must be an integer from ${input.min} to ${input.max}.`,
    );
  }
  return value;
};

export const validateSwordfishRuntimeOverviewInput = (
  input: unknown,
): SwordfishRuntimeOverviewInput | SwordfishReadonlyError => {
  const source = readInputRecord(swordfishRuntimeOverviewToolName, input);
  if (isSwordfishError(source)) return source;
  return {};
};

export const validateSwordfishSymbolSnapshotInput = (
  input: unknown,
): SwordfishSymbolSnapshotInput | SwordfishReadonlyError => {
  const source = readInputRecord(swordfishSymbolSnapshotToolName, input);
  if (isSwordfishError(source)) return source;
  const symbol = readSymbol(source.symbol);
  if (isSwordfishError(symbol)) return symbol;
  return { symbol };
};

export const validateSwordfishBarsRangeInput = (
  input: unknown,
): SwordfishBarsRangeInput | SwordfishReadonlyError => {
  const source = readInputRecord(swordfishBarsRangeToolName, input);
  if (isSwordfishError(source)) return source;
  const symbol = readSymbol(source.symbol);
  if (isSwordfishError(symbol)) return symbol;
  const tf = readTimeframe(source.tf);
  if (isSwordfishError(tf)) return tf;
  const lookbackMinutes = readInteger(source.lookbackMinutes, {
    field: "lookbackMinutes",
    fallback: 60,
    min: 1,
    max: 1440,
  });
  if (isSwordfishError(lookbackMinutes)) return lookbackMinutes;
  const maxBars = readInteger(source.maxBars, {
    field: "maxBars",
    fallback: 50,
    min: 1,
    max: 200,
  });
  if (isSwordfishError(maxBars)) return maxBars;
  if (
    source.endMs !== undefined &&
    (typeof source.endMs !== "number" ||
      !Number.isInteger(source.endMs) ||
      source.endMs < 0 ||
      source.endMs > Date.now() + 60_000)
  ) {
    return swordfishReadonlyError("invalid_input", "endMs must be a valid millisecond timestamp.");
  }
  return {
    symbol,
    tf,
    lookbackMinutes,
    endMs: typeof source.endMs === "number" ? source.endMs : undefined,
    maxBars,
  };
};

const readString = (value: unknown) =>
  typeof value === "string" || typeof value === "number" ? String(value) : undefined;

const readNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const fetchSwordfishJson = async (path: string): Promise<unknown | SwordfishReadonlyError> => {
  if (!path.startsWith("/") || path.startsWith("/admin")) {
    return swordfishReadonlyError("invalid_input", "Unsupported Swordfish public path.");
  }
  const url = new URL(path, swordfishBackendBaseUrl);
  if (url.origin !== swordfishBackendBaseUrl) {
    return swordfishReadonlyError("invalid_input", "Unsupported Swordfish host.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), providerTimeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    const text = await response.text();
    if (text.length > maxProviderResponseBytes) {
      return swordfishReadonlyError(
        "provider_response_invalid",
        "Swordfish response exceeded limit.",
      );
    }
    if (!response.ok) {
      return swordfishReadonlyError(
        "provider_request_failed",
        `Swordfish request failed with HTTP ${response.status}.`,
        response.status >= 500,
      );
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return swordfishReadonlyError(
        "provider_response_invalid",
        "Swordfish response was not JSON.",
      );
    }
  } catch {
    return swordfishReadonlyError("provider_request_failed", "Swordfish request failed.", true);
  } finally {
    clearTimeout(timeout);
  }
};

const compactHealth = (value: unknown): SwordfishRuntimeOverviewOutput["health"] => {
  const source = isRecord(value) ? value : {};
  const services = isRecord(source.services) ? source.services : {};
  return {
    status: readString(source.status),
    timestamp: readNumber(source.timestamp),
    services: {
      redis: readString(services.redis),
      timescaledb: readString(services.timescaledb),
      massiveWs: readString(services.massiveWs),
    },
  };
};

const compactSymbolList = (value: unknown) => {
  const source = isRecord(value) ? value : {};
  const symbols = Array.isArray(source.symbols)
    ? source.symbols
        .map(readString)
        .filter((symbol): symbol is string => Boolean(symbol))
        .slice(0, 10)
    : [];
  return {
    count: typeof source.count === "number" ? source.count : symbols.length,
    sampleSymbols: symbols,
  };
};

const compactSnapshotCount = (value: unknown) => {
  const source = isRecord(value) ? value : {};
  if (typeof source.count === "number") return source.count;
  return isRecord(source.snapshots) ? Object.keys(source.snapshots).length : undefined;
};

export const runSwordfishRuntimeOverview = async (
  _input: SwordfishRuntimeOverviewInput = {},
): Promise<SwordfishRuntimeOverviewResult> => {
  const startedAt = Date.now();
  const [healthPayload, openTickerPayload, symbolsPayload, snapshotsPayload] = await Promise.all([
    fetchSwordfishJson("/health"),
    fetchSwordfishJson("/bars/open-ticker"),
    fetchSwordfishJson("/symbols"),
    fetchSwordfishJson("/snapshots"),
  ]);
  const firstError = [healthPayload, openTickerPayload, symbolsPayload, snapshotsPayload].find(
    isSwordfishError,
  );
  if (firstError) return { ok: false, error: firstError };

  const health = compactHealth(healthPayload);
  const openTicker = isRecord(openTickerPayload)
    ? (readString(openTickerPayload.symbol) ?? null)
    : null;
  const symbols = compactSymbolList(symbolsPayload);
  const snapshotCount = compactSnapshotCount(snapshotsPayload);
  const serviceSummary = [
    `redis=${health.services.redis ?? "unknown"}`,
    `timescaledb=${health.services.timescaledb ?? "unknown"}`,
    `massiveWs=${health.services.massiveWs ?? "unknown"}`,
  ].join(", ");

  return {
    ok: true,
    output: {
      status: "ok",
      summary: `Swordfish public runtime is ${health.status ?? "unknown"} (${serviceSummary}).`,
      source: "swordfish_public",
      backendBaseUrl: swordfishBackendBaseUrl,
      health,
      openTicker,
      symbolCount: symbols.count,
      sampleSymbols: symbols.sampleSymbols,
      snapshotCount,
      timingMs: Date.now() - startedAt,
    },
  };
};

const compactSnapshot = (value: unknown): SwordfishSymbolSnapshotOutput["snapshot"] | null => {
  if (!isRecord(value)) return null;
  return {
    ticker: readString(value.ticker) ?? readString(value.symbol),
    productCode: readString(value.productCode) ?? readString(value.product_code),
    name: readString(value.name),
    timestamp: readNumber(value.timestamp),
    lastPrice: readNumber(value.lastPrice) ?? readString(value.lastPrice),
    change: readNumber(value.change) ?? readString(value.change),
    changePercent: readNumber(value.changePercent) ?? readString(value.changePercent),
    settlementPrice: readNumber(value.settlementPrice) ?? readString(value.settlementPrice),
    prevSettlement: readNumber(value.prevSettlement) ?? readString(value.prevSettlement),
    openInterest: readNumber(value.openInterest) ?? readString(value.openInterest),
    volume: readNumber(value.volume) ?? readString(value.volume),
    settlementDate: readString(value.settlementDate),
  };
};

export const runSwordfishSymbolSnapshot = async (
  input: SwordfishSymbolSnapshotInput,
): Promise<SwordfishSymbolSnapshotResult> => {
  const startedAt = Date.now();
  const payload = await fetchSwordfishJson(`/snapshot/${encodeURIComponent(input.symbol)}`);
  if (isSwordfishError(payload)) return { ok: false, error: payload };
  const snapshot = compactSnapshot(payload);
  if (!snapshot) {
    return {
      ok: false,
      error: swordfishReadonlyError(
        "provider_response_invalid",
        "Swordfish snapshot payload was invalid.",
      ),
    };
  }
  return {
    ok: true,
    output: {
      status: "ok",
      summary: `Loaded public Swordfish snapshot for ${input.symbol}.`,
      source: "swordfish_public",
      symbol: input.symbol,
      snapshot,
      timingMs: Date.now() - startedAt,
    },
  };
};

const compactBar = (value: unknown): SwordfishBarsRangeOutput["bars"][number] | null => {
  if (!isRecord(value)) return null;
  const ts = readNumber(value.ts) ?? readString(value.ts) ?? readNumber(value.timestamp);
  return {
    ts,
    open: readNumber(value.open),
    high: readNumber(value.high),
    low: readNumber(value.low),
    close: readNumber(value.close),
    volume: readNumber(value.volume),
    trades: readNumber(value.trades),
    source: readString(value.source),
  };
};

export const runSwordfishBarsRange = async (
  input: SwordfishBarsRangeInput,
): Promise<SwordfishBarsRangeResult> => {
  const startedAt = Date.now();
  const end = input.endMs ?? Date.now();
  const start = end - input.lookbackMinutes * 60_000;
  const params = new URLSearchParams({
    start: String(start),
    end: String(end),
    tf: input.tf,
  });
  const payload = await fetchSwordfishJson(
    `/bars/range/${encodeURIComponent(input.symbol)}?${params.toString()}`,
  );
  if (isSwordfishError(payload)) return { ok: false, error: payload };
  const source = isRecord(payload) ? payload : {};
  const rows = Array.isArray(source.bars) ? source.bars : [];
  const bars = rows
    .map(compactBar)
    .filter((bar): bar is NonNullable<ReturnType<typeof compactBar>> => bar !== null)
    .slice(-input.maxBars);
  const count = typeof source.count === "number" ? source.count : rows.length;

  return {
    ok: true,
    output: {
      status: "ok",
      summary: `Loaded ${count} public Swordfish ${input.tf} bar${count === 1 ? "" : "s"} for ${
        input.symbol
      }.`,
      source: "swordfish_public",
      symbol: input.symbol,
      tf: input.tf,
      start,
      end,
      count,
      returnedBars: bars.length,
      dataSource: readString(source.source) ?? readString(source.dataSource),
      bars,
      timingMs: Date.now() - startedAt,
    },
  };
};

export const runSwordfishReadonlyTool = async (
  toolName: SwordfishReadonlyToolName,
  input: SwordfishRuntimeOverviewInput | SwordfishSymbolSnapshotInput | SwordfishBarsRangeInput,
): Promise<SwordfishReadonlyResult> => {
  if (toolName === swordfishRuntimeOverviewToolName) {
    return runSwordfishRuntimeOverview(input as SwordfishRuntimeOverviewInput);
  }
  if (toolName === swordfishSymbolSnapshotToolName) {
    return runSwordfishSymbolSnapshot(input as SwordfishSymbolSnapshotInput);
  }
  return runSwordfishBarsRange(input as SwordfishBarsRangeInput);
};
