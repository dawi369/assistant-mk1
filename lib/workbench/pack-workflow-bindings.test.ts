import { describe, expect, it } from "vitest";

import {
  buildPackWorkflowRequest,
  packWorkflowBindings,
  resolvePackWorkflowBinding,
} from "./pack-workflow-bindings";

describe("pack workflow bindings", () => {
  it("returns runnable bindings for Polymancer and Swordfish", () => {
    expect(
      resolvePackWorkflowBinding({
        type: "polymancer.market_research",
        engine: "langgraph",
        status: "declared",
        description: "Market research",
      }),
    ).toMatchObject({
      runnable: true,
      binding: {
        route: "/api/workbench/workflows/polymancer/market-research",
        requiredPackId: "baby-polymancer",
      },
    });

    expect(
      resolvePackWorkflowBinding({
        type: "swordfish.runtime_research",
        engine: "langgraph",
        status: "declared",
        description: "Runtime research",
      }),
    ).toMatchObject({
      runnable: true,
      binding: {
        route: "/api/workbench/workflows/swordfish/runtime-research",
        requiredPackId: "baby-swordfish",
      },
    });
  });

  it("reports unknown workflows as declared-only", () => {
    expect(
      resolvePackWorkflowBinding({
        type: "example.future_workflow",
        engine: "langgraph",
        status: "declared",
        description: "Future workflow",
      }),
    ).toEqual({
      runnable: false,
      workflow: {
        type: "example.future_workflow",
        engine: "langgraph",
        status: "declared",
        description: "Future workflow",
      },
      reason: "declared_only",
    });
  });

  it("builds bounded dry-run Polymancer requests", () => {
    expect(
      buildPackWorkflowRequest("polymancer.market_research", {
        query: "  GTA markets  ",
        url: "https://example.com",
        token: "secret",
      }),
    ).toEqual({
      executionMode: "dry_run",
      input: { query: "GTA markets" },
    });

    expect(buildPackWorkflowRequest("polymancer.market_research", {})).toEqual({
      executionMode: "dry_run",
      input: { query: "GTA" },
    });
  });

  it("builds bounded dry-run Swordfish requests", () => {
    expect(
      buildPackWorkflowRequest("swordfish.runtime_research", {
        symbol: " esh6 ",
        tf: "5m",
        lookbackMinutes: "120",
        maxBars: 500,
        includeBars: false,
        url: "https://example.com",
        token: "secret",
      }),
    ).toEqual({
      executionMode: "dry_run",
      input: {
        symbol: "ESH6",
        tf: "5m",
        lookbackMinutes: 120,
        maxBars: 200,
        includeBars: false,
      },
    });

    expect(buildPackWorkflowRequest("swordfish.runtime_research", { tf: "2m" })).toEqual({
      executionMode: "dry_run",
      input: {
        tf: "1m",
        lookbackMinutes: 60,
        maxBars: 25,
        includeBars: true,
      },
    });
  });

  it("keeps required pack ids explicit", () => {
    expect(packWorkflowBindings["polymancer.market_research"].requiredPackId).toBe(
      "baby-polymancer",
    );
    expect(packWorkflowBindings["swordfish.runtime_research"].requiredPackId).toBe(
      "baby-swordfish",
    );
  });
});
