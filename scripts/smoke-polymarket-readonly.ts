import {
  runPolymarketMarketSearch,
  runPolymarketMarketSnapshot,
  runPolymarketOrderbookSnapshot,
} from "../lib/workbench/polymarket-readonly";

const fail = (message: string): never => {
  console.error(message);
  process.exitCode = 1;
  throw new Error(message);
};

const unwrap = <Output>(
  result: { ok: true; output: Output } | { ok: false; error: { message: string } },
  label: string,
): Output => {
  if (result.ok) return result.output;
  return fail(`${label} failed: ${result.error.message}`);
};

const main = async () => {
  const search = unwrap(
    await runPolymarketMarketSearch({ query: "GTA", limit: 5 }),
    "market.search",
  );
  const market = search.markets.find((item) => item.clobTokenIds.length > 0);
  const slug = market?.slug;
  if (!market || !slug) {
    return fail("market.search did not return a market with a slug and CLOB token ids.");
  }

  const snapshot = unwrap(await runPolymarketMarketSnapshot({ slug }), "market.snapshot");
  const tokenId = snapshot.market.clobTokenIds[0] ?? market.clobTokenIds[0];
  if (!tokenId) fail("market.snapshot did not return a CLOB token id.");

  const orderbook = unwrap(await runPolymarketOrderbookSnapshot({ tokenId }), "orderbook.snapshot");

  console.log(
    JSON.stringify(
      {
        ok: true,
        search: {
          summary: search.summary,
          marketCount: search.markets.length,
          timingMs: search.timingMs,
        },
        snapshot: {
          summary: snapshot.summary,
          slug: snapshot.market.slug,
          outcomes: snapshot.market.outcomes,
          clobTokenIds: snapshot.market.clobTokenIds.length,
          timingMs: snapshot.timingMs,
        },
        orderbook: {
          summary: orderbook.summary,
          bestBid: orderbook.bestBid,
          bestAsk: orderbook.bestAsk,
          spread: orderbook.spread,
          timingMs: orderbook.timingMs,
        },
      },
      null,
      2,
    ),
  );
};

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
