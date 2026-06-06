import { upsertActiveAgentPreference } from "./authz";
import { selectAgent, selectMembership, selectWorkspaceAgents } from "./authz-store";
import { json } from "./http";
import { requireAdminMembership } from "./membership-policy";
import type { AgentIdentity, AgentRow, Env } from "./types";

const toAgentSummary = (row: AgentRow, activeAgentId: string) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  status: row.status,
  isDefault: row.is_default === 1,
  isActive: row.id === activeAgentId,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const handleListAgents = async (env: Env, identity: AgentIdentity) => {
  const agents = await selectWorkspaceAgents(env, identity.scope.workspaceId);

  return json({
    ok: true,
    activeAgentId: identity.agentId,
    agents: agents.results.map((agent) => toAgentSummary(agent, identity.agentId)),
  });
};

export const handleActivateAgent = async (env: Env, identity: AgentIdentity, agentId: string) => {
  const currentMembership = await selectMembership(
    env,
    identity.scope.userId,
    identity.scope.workspaceId,
  );
  const adminError = requireAdminMembership(currentMembership);
  if (adminError) return adminError;

  const agent = await selectAgent(env, agentId, identity.scope.workspaceId);
  if (!agent) {
    return json({ ok: false, error: "Agent not found" }, { status: 404 });
  }
  if (agent.status !== "active") {
    return json({ ok: false, error: "Agent is not active" }, { status: 403 });
  }

  await upsertActiveAgentPreference(env, {
    userId: identity.scope.userId,
    workspaceId: identity.scope.workspaceId,
    agentId: agent.id,
    reason: "agent-activated",
  });

  return json({
    ok: true,
    activeAgentId: agent.id,
    agent: toAgentSummary(agent, agent.id),
  });
};
