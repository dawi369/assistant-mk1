import type { ToolSummary } from "./workbench-types";

export type PackCapabilitySource = {
  tools: ReadonlyArray<{
    id: string;
    required?: boolean;
    executionModes?: readonly string[];
    modelVisibleDefault?: boolean;
    purpose?: string;
  }>;
};

export type PackToolCapability = {
  id: string;
  purpose?: string;
  required: boolean;
  executionModes: string[];
  modelVisibleDefault: boolean;
  declared: boolean;
  registered: boolean;
  adminVisible?: boolean;
  modelVisible?: boolean;
  mutationRisk?: ToolSummary["mutationRisk"];
  requiresSecrets?: boolean;
  status?: string;
  reason?: string;
  permissionStatus?: ToolSummary["permissionStatus"];
};

export const resolvePackToolCapabilities = (
  pack: PackCapabilitySource | null | undefined,
  toolSummaries: ToolSummary[] = [],
): PackToolCapability[] => {
  if (!pack) return [];

  const summariesByName = new Map(toolSummaries.map((tool) => [tool.name, tool]));

  return pack.tools.map((tool) => {
    const summary = summariesByName.get(tool.id);
    const packScope = summary?.packScope;
    return {
      id: tool.id,
      purpose: packScope?.purpose ?? tool.purpose ?? summary?.description,
      required: packScope?.required ?? tool.required ?? false,
      executionModes: [
        ...(packScope?.executionModes?.length
          ? packScope.executionModes
          : (tool.executionModes ?? summary?.supportedExecutionModes ?? [])),
      ],
      modelVisibleDefault: packScope?.modelVisibleDefault ?? tool.modelVisibleDefault ?? false,
      declared: packScope?.declared ?? true,
      registered: Boolean(summary),
      adminVisible: summary?.adminVisible,
      modelVisible: summary?.modelVisible,
      mutationRisk: summary?.mutationRisk,
      requiresSecrets: summary?.requiresSecrets,
      status: summary?.status,
      reason: summary?.reason,
      permissionStatus: summary?.permissionStatus,
    };
  });
};
