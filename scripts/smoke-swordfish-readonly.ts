import {
  runSwordfishBarsRange,
  runSwordfishRuntimeOverview,
  runSwordfishSymbolSnapshot,
} from "../lib/workbench/swordfish-readonly";

const unwrap = <T>(
  result: { ok: true; output: T } | { ok: false; error: unknown },
  label: string,
) => {
  if (!result.ok) throw new Error(`${label} failed: ${JSON.stringify(result.error)}`);
  return result.output;
};

const main = async () => {
  const overview = unwrap(await runSwordfishRuntimeOverview({}), "runtime.overview");
  const symbol = overview.openTicker ?? overview.sampleSymbols[0] ?? "ESH6";
  const snapshotResult = await runSwordfishSymbolSnapshot({ symbol });
  const snapshot = snapshotResult.ok ? snapshotResult.output : null;
  const bars = unwrap(
    await runSwordfishBarsRange({ symbol, tf: "1m", lookbackMinutes: 60, maxBars: 25 }),
    "bars.range",
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        overview: {
          summary: overview.summary,
          openTicker: overview.openTicker,
          symbolCount: overview.symbolCount,
          snapshotCount: overview.snapshotCount,
          timingMs: overview.timingMs,
        },
        snapshot: snapshot
          ? {
              summary: snapshot.summary,
              symbol: snapshot.symbol,
              timingMs: snapshot.timingMs,
            }
          : {
              skipped: true,
              reason: snapshotResult.ok ? undefined : snapshotResult.error.message,
            },
        bars: {
          summary: bars.summary,
          symbol: bars.symbol,
          count: bars.count,
          returnedBars: bars.returnedBars,
          timingMs: bars.timingMs,
        },
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
