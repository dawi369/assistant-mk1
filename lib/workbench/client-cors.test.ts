import { describe, expect, it } from "vitest";

import { applyWorkbenchClientCors, parseWorkbenchClientOrigins } from "./client-cors";

describe("workbench client CORS", () => {
  it("accepts only exact configured URL origins", () => {
    expect([
      ...parseWorkbenchClientOrigins("https://app.example, *, null, https://mobile.example"),
    ]).toEqual(["https://app.example", "https://mobile.example"]);
  });

  it("adds bounded credentialed preflight headers for an allowed frontend", () => {
    const headers = new Headers();
    expect(
      applyWorkbenchClientCors(headers, {
        configuredOrigins: "https://app.example",
        origin: "https://app.example",
        preflight: true,
      }),
    ).toBe(true);
    expect(headers.get("access-control-allow-origin")).toBe("https://app.example");
    expect(headers.get("access-control-allow-credentials")).toBe("true");
    expect(headers.get("access-control-allow-headers")).toContain("authorization");
    expect(headers.get("access-control-allow-headers")).toContain("idempotency-key");
  });

  it("does not grant an unconfigured origin", () => {
    const headers = new Headers();
    expect(
      applyWorkbenchClientCors(headers, {
        configuredOrigins: "https://app.example",
        origin: "https://attacker.example",
      }),
    ).toBe(false);
    expect(headers.has("access-control-allow-origin")).toBe(false);
  });
});
