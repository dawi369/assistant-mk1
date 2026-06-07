import { describe, it, expect } from "vitest";

import type { ToolDefinition, ToolExposureContext } from "@/lib/agent-framework/contracts";
import {
  DEMO_INSPECT_TOOL_NAME,
  workbenchToolExposureResolver,
  workbenchToolRegistry,
} from "./tool-registry";
import { demoInspectTool } from "./demo-tool";

const scope = { userId: "u1", workspaceId: "w1" };

describe("workbenchToolRegistry", () => {
  it("contains the demo.inspect tool", () => {
    const tool = workbenchToolRegistry.get(DEMO_INSPECT_TOOL_NAME);
    expect(tool).toBeDefined();
    expect(tool!.name).toBe("demo.inspect");
  });
});

describe("DEMO_INSPECT_TOOL_NAME", () => {
  it("equals the demoInspectTool name", () => {
    expect(DEMO_INSPECT_TOOL_NAME).toBe(demoInspectTool.name);
    expect(DEMO_INSPECT_TOOL_NAME).toBe("demo.inspect");
  });
});

describe("workbenchToolExposureResolver", () => {
  it("shows demo.inspect when mode=dry_run and stage=observe", async () => {
    const context: ToolExposureContext = {
      scope,
      agentId: "a1",
      execution: { mode: "dry_run" },
      stage: "observe",
    };
    const decisions = await workbenchToolExposureResolver(
      [demoInspectTool as ToolDefinition],
      context,
    );
    expect(decisions).toHaveLength(1);
    expect(decisions[0].visible).toBe(true);
    expect(decisions[0].reason).toMatch(/demo inspect/i);
  });

  it("hides demo.inspect when mode is not dry_run", async () => {
    const context: ToolExposureContext = {
      scope,
      agentId: "a1",
      execution: { mode: "execute" },
      stage: "observe",
    };
    const decisions = await workbenchToolExposureResolver(
      [demoInspectTool as ToolDefinition],
      context,
    );
    expect(decisions[0].visible).toBe(false);
  });

  it("hides demo.inspect when stage is not observe", async () => {
    const context: ToolExposureContext = {
      scope,
      agentId: "a1",
      execution: { mode: "dry_run" },
      stage: "execute",
    };
    const decisions = await workbenchToolExposureResolver(
      [demoInspectTool as ToolDefinition],
      context,
    );
    expect(decisions[0].visible).toBe(false);
  });

  it("hides non-demo.inspect tools even in dry_run/observe", async () => {
    const otherTool = {
      name: "other.tool",
      description: "other",
      execute: async () => ({ ok: true as const, output: {} }),
    };
    const context: ToolExposureContext = {
      scope,
      agentId: "a1",
      execution: { mode: "dry_run" },
      stage: "observe",
    };
    const decisions = await workbenchToolExposureResolver([otherTool], context);
    expect(decisions[0].visible).toBe(false);
  });
});
