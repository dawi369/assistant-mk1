import type { AgentBehaviorTemplate, AgentSummary } from "./workbench-types";

export type AdminAgentPackState = "current" | "ready" | "update_available" | "not_instantiated";

export const resolveAdminAgentPackState = (
  template: AgentBehaviorTemplate,
  agents: AgentSummary[],
  activeAgentId?: string | null,
) => {
  const packId = template.pack?.id;
  if (!packId) return null;
  const packAgents = agents.filter((agent) => agent.behavior.pack?.id === packId);
  const currentVersionAgent = packAgents.find(
    (agent) =>
      agent.status === "active" && agent.behavior.authoring?.packVersion === template.version,
  );
  const state: AdminAgentPackState =
    currentVersionAgent?.id === activeAgentId
      ? "current"
      : currentVersionAgent
        ? "ready"
        : packAgents.length
          ? "update_available"
          : "not_instantiated";
  return { state, currentVersionAgent: currentVersionAgent ?? null, packAgents };
};
