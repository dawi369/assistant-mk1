import { resolvePackWorkflowBinding, type PackWorkflowBinding } from "./pack-workflow-bindings";

type AgentSlashPackWorkflow = Parameters<typeof resolvePackWorkflowBinding>[0];

export type AgentSlashPack = {
  id: string;
  tools: ReadonlyArray<{ id: string }>;
  workflows: ReadonlyArray<AgentSlashPackWorkflow>;
};

export type AgentSlashWorkflowAction = {
  id: string;
  label: string;
  description: string;
  binding: PackWorkflowBinding;
};

const slashCommandIds: Record<string, string> = {
  "polymancer.market_research": "market-research",
  "swordfish.runtime_research": "runtime-research",
};

export const resolveAgentSlashWorkflowActions = (
  pack: AgentSlashPack | null | undefined,
): AgentSlashWorkflowAction[] => {
  if (!pack) return [];

  return pack.workflows.flatMap((workflow) => {
    if (workflow.userInvocable === false) return [];
    const resolved = resolvePackWorkflowBinding(workflow);
    if (!resolved.runnable || resolved.binding.requiredPackId !== pack.id) return [];

    const toolNames = pack.tools.map((tool) => tool.id).join(", ");
    return [
      {
        id: slashCommandIds[resolved.binding.workflowType] ?? workflow.type.replaceAll(".", "-"),
        label: resolved.binding.label,
        description: toolNames
          ? `${pack.id}: ${resolved.binding.description} Uses ${toolNames}.`
          : `${pack.id}: ${resolved.binding.description}`,
        binding: resolved.binding,
      },
    ];
  });
};
