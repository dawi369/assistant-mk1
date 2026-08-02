import { describe, expect, it } from "vitest";

import { resolveLegacyLangGraphApiKey } from "./langgraph-proxy-auth";

describe("LangGraph proxy authentication", () => {
  it("retains the API-key compatibility path for local development", () => {
    expect(resolveLegacyLangGraphApiKey({ apiKey: "local-key", nodeEnv: "development" })).toBe(
      "local-key",
    );
  });

  it("rejects the API-key compatibility path in production", () => {
    expect(() =>
      resolveLegacyLangGraphApiKey({ apiKey: "hosted-key", nodeEnv: "production" }),
    ).toThrow("signed Cloudflare facade");
  });

  it("returns no credential when the compatibility key is absent", () => {
    expect(resolveLegacyLangGraphApiKey({ nodeEnv: "production" })).toBeUndefined();
  });
});
