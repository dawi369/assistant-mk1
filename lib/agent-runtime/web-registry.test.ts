import { describe, expect, it } from "vitest";

import { resolveArtifactRenderer, sanitizeRendererValue } from "./web-registry";

describe("compiled web runtime registry", () => {
  it("resolves a trusted package renderer with runtime metadata", () => {
    const resolved = resolveArtifactRenderer("complex_operator_report");
    expect(resolved).toMatchObject({
      packId: "complex-operator",
      runtimeVersion: "1.0.0",
      descriptor: { renderer: "table" },
    });
    expect(typeof resolved?.renderer).toBe("function");
  });

  it("bounds renderer props and removes credential-like keys", () => {
    const value = sanitizeRendererValue({
      token: "hidden",
      nested: {
        authorization: "hidden",
        visible: "kept",
      },
      long: "x".repeat(20_000),
    }) as Record<string, unknown>;
    expect(value).not.toHaveProperty("token");
    expect(value.nested).toEqual({ visible: "kept" });
    expect(String(value.long)).toHaveLength(16_384);
  });
});
