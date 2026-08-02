import { describe, expect, it } from "vitest";

import { assessLocalNodeRuntime } from "./node-runtime";

describe("Node runtime policy", () => {
  it("uses Node 24 as the release runtime", () => {
    expect(assessLocalNodeRuntime("24.18.0")).toEqual({
      supported: true,
      message: "Node.js 24.18.0 matches the release runtime (24.x)",
    });
  });

  it("accepts Node 26 only as a local development runtime", () => {
    expect(assessLocalNodeRuntime("26.5.0")).toEqual({
      supported: true,
      message: "Node.js 26.5.0 is accepted for local development; release verification uses 24.x",
    });
  });

  it("rejects runtimes outside the explicit policy", () => {
    expect(assessLocalNodeRuntime("22.22.0")).toMatchObject({ supported: false });
  });
});
