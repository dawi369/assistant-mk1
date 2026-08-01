import { describe, expect, it } from "vitest";

import { createAgentPackTestFetch } from "./agent-pack-test-fetch";

describe("agent-pack deterministic fetch", () => {
  it("serves bounded Polymarket fixtures without provider traffic", async () => {
    const fetchFixture = createAgentPackTestFetch();
    const markets = await fetchFixture(
      "https://gamma-api.polymarket.com/markets?active=true&limit=5",
    );
    const book = await fetchFixture(
      "https://clob.polymarket.com/book?token_id=conformance-token-yes",
    );

    await expect(markets.json()).resolves.toEqual([
      expect.objectContaining({
        slug: "gta-vi-launch-before-2027",
        clobTokenIds: ["conformance-token-yes", "conformance-token-no"],
      }),
    ]);
    await expect(book.json()).resolves.toEqual(
      expect.objectContaining({ asset_id: "conformance-token-yes" }),
    );
  });

  it("fails closed on undeclared external requests", async () => {
    await expect(createAgentPackTestFetch()("https://example.com/data")).rejects.toThrow(
      "unexpected external request",
    );
  });
});
