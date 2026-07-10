import { describe, expect, it } from "vitest";

import { babyPolymancerPack } from "../../agent-packs/baby-polymancer";
import { resolvePackToolCapabilities } from "./pack-capabilities";
import type { ToolSummary } from "./workbench-types";

const liveTool = {
  name: "polymarket.market.search",
  description: "Search public Polymarket markets.",
  kind: "native",
  family: "finance",
  status: "available",
  supportedExecutionModes: ["dry_run"],
  adminVisible: true,
  modelVisible: false,
  reason: "Allowed for admin dry-run. No model-visible tools are enabled for this agent.",
  requiresSecrets: false,
  mutationRisk: "read_only",
  packScope: {
    activePackId: "baby-polymancer",
    declared: true,
    invocation: "workflow",
    required: true,
    modelVisibleDefault: false,
    executionModes: ["dry_run"],
    purpose: "Discover public markets by query, slug, or tag.",
  },
} satisfies ToolSummary;

describe("pack capabilities", () => {
  it("resolves Baby Polymancer declared tools as read-only model-hidden capabilities", () => {
    const capabilities = resolvePackToolCapabilities(babyPolymancerPack);

    expect(capabilities.map((tool) => tool.id)).toEqual([
      "polymarket.market.search",
      "polymarket.market.snapshot",
      "polymarket.orderbook.snapshot",
    ]);
    expect(capabilities.every((tool) => tool.executionModes.includes("dry_run"))).toBe(true);
    expect(capabilities.every((tool) => tool.modelVisibleDefault === false)).toBe(true);
    expect(capabilities.every((tool) => tool.invocation === "workflow")).toBe(true);
    expect(capabilities.every((tool) => tool.required)).toBe(true);
  });

  it("merges live visibility and policy metadata onto declared pack tools", () => {
    const [capability] = resolvePackToolCapabilities(babyPolymancerPack, [liveTool]);

    expect(capability).toMatchObject({
      id: "polymarket.market.search",
      registered: true,
      declared: true,
      invocation: "workflow",
      adminVisible: true,
      modelVisible: false,
      mutationRisk: "read_only",
      purpose: "Discover public markets by query, slug, or tag.",
    });
  });
});
