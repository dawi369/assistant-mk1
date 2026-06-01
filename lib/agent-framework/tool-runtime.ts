import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExposureContext,
  ToolExposureDecision,
  ToolExposureResolver,
  ToolResult,
} from "./contracts";

export type RuntimeToolDefinition = ToolDefinition<any, any>;

export type ToolExecutionRequest<Input = unknown> = {
  toolName: string;
  input: Input;
  context: ToolExecutionContext;
};

export class RuntimeToolRegistry {
  private readonly tools = new Map<string, RuntimeToolDefinition>();

  constructor(tools: RuntimeToolDefinition[] = []) {
    for (const tool of tools) this.register(tool);
  }

  register(tool: RuntimeToolDefinition) {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool is already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
    return this;
  }

  get(toolName: string) {
    return this.tools.get(toolName);
  }

  require(toolName: string) {
    const tool = this.get(toolName);
    if (!tool) throw new Error(`Tool is not registered: ${toolName}`);
    return tool;
  }

  list() {
    return Array.from(this.tools.values());
  }
}

export const createRuntimeToolRegistry = (tools: RuntimeToolDefinition[] = []) =>
  new RuntimeToolRegistry(tools);

export const defaultToolExposureResolver: ToolExposureResolver = async (tools, context) => {
  const decisions: ToolExposureDecision[] = [];
  for (const tool of tools) {
    const available = tool.isAvailable ? await tool.isAvailable(context.scope) : true;
    decisions.push({
      tool,
      visible: available,
      reason: available
        ? "Tool is available for this scope."
        : "Tool is unavailable for this scope.",
    });
  }
  return decisions;
};

export const resolveToolExposure = async (
  registry: RuntimeToolRegistry,
  context: ToolExposureContext,
  resolver: ToolExposureResolver = defaultToolExposureResolver,
) => resolver(registry.list(), context);

export const getVisibleTools = async (
  registry: RuntimeToolRegistry,
  context: ToolExposureContext,
  resolver: ToolExposureResolver = defaultToolExposureResolver,
) => {
  const decisions = await resolveToolExposure(registry, context, resolver);
  return decisions.filter((decision) => decision.visible).map((decision) => decision.tool);
};

export const executeRegisteredTool = async <Input = unknown, Output = unknown>(
  registry: RuntimeToolRegistry,
  request: ToolExecutionRequest<Input>,
): Promise<ToolResult<Output>> => {
  const tool = registry.require(request.toolName) as ToolDefinition<Input, Output>;
  return tool.execute(request.input, request.context);
};
