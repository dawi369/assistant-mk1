import type { ToolExposureResolver } from "@/lib/agent-framework/contracts";
import { createRuntimeToolRegistry } from "@/lib/agent-framework/tool-runtime";
import { demoInspectTool } from "@/lib/workbench/demo-tool";
import type { DemoInspectInput, DemoInspectOutput } from "@/lib/workbench/demo-tool";

export type { DemoInspectInput, DemoInspectOutput };

export const DEMO_INSPECT_TOOL_NAME = demoInspectTool.name;

export const workbenchToolRegistry = createRuntimeToolRegistry([demoInspectTool]);

export const workbenchToolExposureResolver: ToolExposureResolver = async (tools, context) => {
  return tools.map((tool) => {
    const visible =
      context.execution.mode === "dry_run" &&
      context.stage === "observe" &&
      tool.name === DEMO_INSPECT_TOOL_NAME;

    return {
      tool,
      visible,
      reason: visible
        ? "Demo inspect is available for dry-run observe workflows."
        : "Tool is not exposed for this workbench workflow context.",
    };
  });
};
