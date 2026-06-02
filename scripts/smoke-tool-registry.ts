import type { ToolDefinition, ToolExposureResolver } from "../lib/agent-framework/contracts";
import {
  createRuntimeToolRegistry,
  defaultToolExposureResolver,
  executeRegisteredTool,
  getVisibleTools,
} from "../lib/agent-framework/tool-runtime";
import {
  DEMO_INSPECT_TOOL_NAME,
  workbenchToolExposureResolver,
  workbenchToolRegistry,
} from "../lib/workbench/tool-registry";

const scope = {
  userId: "dev-user",
  workspaceId: "dev-workspace",
};

const agentId = "dev-agent";

const visibleTool: ToolDefinition<{ value: string }, { value: string }> = {
  name: "smoke.visible",
  description: "Visible smoke tool.",
  execute: async (input) => ({ ok: true, output: input }),
};

const hiddenTool: ToolDefinition = {
  name: "smoke.hidden",
  description: "Hidden smoke tool.",
  execute: async () => ({ ok: true, output: {} }),
};

const unavailableTool: ToolDefinition = {
  name: "smoke.unavailable",
  description: "Unavailable smoke tool.",
  isAvailable: () => false,
  execute: async () => ({ ok: true, output: {} }),
};

const filteringResolver: ToolExposureResolver = (tools) =>
  tools.map((tool) => ({
    tool,
    visible: tool.name === visibleTool.name,
    reason: tool.name === visibleTool.name ? "selected" : "filtered",
  }));

const requireToolNames = (label: string, tools: ToolDefinition[], expectedNames: string[]) => {
  const names = tools.map((tool) => tool.name).sort();
  const expected = [...expectedNames].sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new Error(`${label} expected ${expected.join(", ")}, got ${names.join(", ")}`);
  }
};

const main = async () => {
  const registry = createRuntimeToolRegistry([visibleTool, hiddenTool, unavailableTool]);
  if (registry.get(visibleTool.name) !== visibleTool) {
    throw new Error("Registered tool lookup returned the wrong definition");
  }

  try {
    registry.register(visibleTool);
    throw new Error("Duplicate registration did not throw");
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("already registered")) throw error;
  }

  const defaultVisible = await getVisibleTools(
    registry,
    {
      scope,
      agentId,
      execution: { mode: "dry_run" },
    },
    defaultToolExposureResolver,
  );
  requireToolNames("default resolver", defaultVisible, [visibleTool.name, hiddenTool.name]);

  const filteredVisible = await getVisibleTools(
    registry,
    {
      scope,
      agentId,
      execution: { mode: "dry_run" },
    },
    filteringResolver,
  );
  requireToolNames("filtering resolver", filteredVisible, [visibleTool.name]);

  const result = await executeRegisteredTool<{ value: string }, { value: string }>(registry, {
    toolName: visibleTool.name,
    input: { value: "ok" },
    context: {
      scope,
      execution: { mode: "dry_run" },
    },
  });
  if (!result.ok || result.output.value !== "ok") {
    throw new Error("Registered tool execution returned the wrong output");
  }

  const workbenchVisible = await getVisibleTools(
    workbenchToolRegistry,
    {
      scope,
      agentId,
      execution: { mode: "dry_run" },
      stage: "observe",
    },
    workbenchToolExposureResolver,
  );
  requireToolNames("workbench resolver", workbenchVisible, [DEMO_INSPECT_TOOL_NAME]);

  const workbenchHidden = await getVisibleTools(
    workbenchToolRegistry,
    {
      scope,
      agentId,
      execution: { mode: "execute" },
      stage: "execute",
    },
    workbenchToolExposureResolver,
  );
  requireToolNames("workbench execute resolver", workbenchHidden, []);

  console.log("Tool registry smoke passed");
  console.log(
    JSON.stringify(
      {
        registeredTools: registry.list().length,
        defaultVisible: defaultVisible.length,
        filteredVisible: filteredVisible.length,
        workbenchVisible: workbenchVisible.map((tool) => tool.name),
      },
      null,
      2,
    ),
  );
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
