import { afterEach, describe, expect, it, vi } from "vitest";

import {
  runSwordfishBarsRange,
  runSwordfishRuntimeOverview,
  runSwordfishSymbolSnapshot,
  swordfishRuntimeOverviewToolName,
  validateSwordfishBarsRangeInput,
  validateSwordfishRuntimeOverviewInput,
  validateSwordfishSymbolSnapshotInput,
} from "./swordfish-readonly";

describe("swordfish readonly tools", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects unsupported fields, URLs, invalid symbols, and oversized ranges", () => {
    expect(validateSwordfishRuntimeOverviewInput({ url: "http://localhost" })).toEqual(
      expect.objectContaining({ code: "invalid_input", redacted: true }),
    );
    expect(validateSwordfishSymbolSnapshotInput({ symbol: "http://localhost/private" })).toEqual(
      expect.objectContaining({ code: "invalid_input", redacted: true }),
    );
    expect(validateSwordfishBarsRangeInput({ symbol: "ESH6", tf: "1s" })).toEqual(
      expect.objectContaining({
        code: "invalid_input",
        message: "tf must be one of 1m, 5m, 15m, 30m, or 1h.",
      }),
    );
    expect(validateSwordfishBarsRangeInput({ symbol: "ESH6", lookbackMinutes: 2000 })).toEqual(
      expect.objectContaining({
        code: "invalid_input",
        message: "lookbackMinutes must be an integer from 1 to 1440.",
      }),
    );
    expect(validateSwordfishBarsRangeInput({ symbol: "ESH6", maxBars: 500 })).toEqual(
      expect.objectContaining({
        code: "invalid_input",
        message: "maxBars must be an integer from 1 to 200.",
      }),
    );
  });

  it("accepts bounded public runtime, snapshot, and bars inputs", () => {
    expect(validateSwordfishRuntimeOverviewInput({})).toEqual({});
    expect(validateSwordfishSymbolSnapshotInput({ symbol: "esh6" })).toEqual({ symbol: "ESH6" });
    expect(validateSwordfishBarsRangeInput({ symbol: "ESH6", tf: "5m", maxBars: 10 })).toEqual({
      symbol: "ESH6",
      tf: "5m",
      lookbackMinutes: 60,
      endMs: undefined,
      maxBars: 10,
    });
  });

  it("projects runtime overview without raw provider payload passthrough", async () => {
    const responses: Record<string, unknown> = {
      "/health": {
        status: "ok",
        timestamp: 123,
        services: { redis: "connected", timescaledb: "connected", massiveWs: "connected" },
        rawProviderOnly: "must not pass through",
      },
      "/bars/open-ticker": { symbol: "ESH6" },
      "/symbols": { symbols: ["ESH6", "NQH6"], count: 2 },
      "/snapshots": { snapshots: { ESH6: {}, NQH6: {} }, count: 2 },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL | string) => {
        const path = new URL(String(url)).pathname;
        return new Response(JSON.stringify(responses[path]), { status: 200 });
      }),
    );

    const result = await runSwordfishRuntimeOverview({});

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.output).toMatchObject({
      health: {
        status: "ok",
        timestamp: 123,
        services: { redis: "connected", timescaledb: "connected", massiveWs: "connected" },
      },
      openTicker: "ESH6",
      symbolCount: 2,
      sampleSymbols: ["ESH6", "NQH6"],
      snapshotCount: 2,
    });
    expect(JSON.stringify(result.output)).not.toContain("rawProviderOnly");
  });

  it("projects symbol snapshots and bars into compact outputs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL | string) => {
        const parsed = new URL(String(url));
        if (parsed.pathname === "/snapshot/ESH6") {
          return new Response(
            JSON.stringify({
              ticker: "ESH6",
              productCode: "ES",
              timestamp: 123,
              settlementPrice: 5010,
              rawProviderOnly: "must not pass through",
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            source: "redis",
            count: 3,
            bars: [
              { ts: 1, open: 1, high: 2, low: 1, close: 2, ignored: true },
              { ts: 2, open: 2, high: 3, low: 2, close: 3 },
              { ts: 3, open: 3, high: 4, low: 3, close: 4 },
            ],
            rawProviderOnly: "must not pass through",
          }),
          { status: 200 },
        );
      }),
    );

    const snapshot = await runSwordfishSymbolSnapshot({ symbol: "ESH6" });
    const bars = await runSwordfishBarsRange({
      symbol: "ESH6",
      tf: "1m",
      lookbackMinutes: 60,
      maxBars: 2,
    });

    expect(snapshot.ok).toBe(true);
    expect(bars.ok).toBe(true);
    if (!snapshot.ok || !bars.ok) throw new Error("expected success");
    expect(snapshot.output.snapshot).toMatchObject({
      ticker: "ESH6",
      productCode: "ES",
      timestamp: 123,
      settlementPrice: 5010,
    });
    expect(bars.output).toMatchObject({
      symbol: "ESH6",
      tf: "1m",
      count: 3,
      returnedBars: 2,
      dataSource: "redis",
      bars: [
        { ts: 2, open: 2, high: 3, low: 2, close: 3 },
        { ts: 3, open: 3, high: 4, low: 3, close: 4 },
      ],
    });
    expect(JSON.stringify({ snapshot: snapshot.output, bars: bars.output })).not.toContain(
      "rawProviderOnly",
    );
    expect(swordfishRuntimeOverviewToolName).toBe("swordfish.runtime.overview");
  });

  it("returns redacted provider errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 503 })),
    );

    const result = await runSwordfishRuntimeOverview({});

    expect(result).toEqual({
      ok: false,
      error: {
        code: "provider_request_failed",
        message: "Swordfish request failed with HTTP 503.",
        retryable: true,
        redacted: true,
      },
    });
  });
});
