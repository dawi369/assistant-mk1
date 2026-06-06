import {
  insertAgent,
  normalizeAgentProfile,
  normalizeOpenRouterModel,
  toAgentSummary,
} from "./agent-records";
import { upsertActiveAgentPreference } from "./authz";
import { selectAgent, selectMembership, selectWorkspaceAgents } from "./authz-store";
import { isRecord, json, parseJson } from "./http";
import { requireAdminMembership } from "./membership-policy";
import type { AgentIdentity, Env } from "./types";

const agentNameMaxLength = 80;
const agentDescriptionMaxLength = 240;

export const handleListAgents = async (env: Env, identity: AgentIdentity) => {
  const agents = await selectWorkspaceAgents(env, identity.scope.workspaceId);

  return json({
    ok: true,
    activeAgentId: identity.agentId,
    agents: agents.results.map((agent) => toAgentSummary(env, agent, identity.agentId)),
  });
};

export const handleCreateAgent = async (request: Request, env: Env, identity: AgentIdentity) => {
  const currentMembership = await selectMembership(
    env,
    identity.scope.userId,
    identity.scope.workspaceId,
  );
  const adminError = requireAdminMembership(currentMembership);
  if (adminError) return adminError;

  const body = parseJson(await request.text());
  const rawName = isRecord(body) && typeof body.name === "string" ? body.name.trim() : "";
  const name = rawName.slice(0, agentNameMaxLength);
  if (!name) {
    return json({ ok: false, error: "Agent name is required" }, { status: 400 });
  }

  const rawDescription =
    isRecord(body) && typeof body.description === "string" ? body.description.trim() : "";
  const description = rawDescription ? rawDescription.slice(0, agentDescriptionMaxLength) : null;
  const profile = normalizeAgentProfile(isRecord(body) ? body.profile : undefined);
  if (!profile) {
    return json(
      { ok: false, error: "Agent profile must be one of default, analyst, or operator" },
      { status: 400 },
    );
  }
  const rawModel = isRecord(body) ? body.model : undefined;
  const normalizedModel = rawModel === undefined ? undefined : normalizeOpenRouterModel(rawModel);
  if (rawModel !== undefined && !normalizedModel) {
    return json(
      {
        ok: false,
        error: "Agent model must be one of deepseek/deepseek-v4-flash or openai/gpt-4.1-mini",
      },
      { status: 400 },
    );
  }
  const model = normalizedModel ?? undefined;

  const agentId = await insertAgent(env, {
    workspaceId: identity.scope.workspaceId,
    userId: identity.scope.userId,
    name,
    description,
    profile,
    model,
  });
  const agent = await selectAgent(env, agentId, identity.scope.workspaceId);
  if (!agent) {
    return json({ ok: false, error: "Created agent not found" }, { status: 500 });
  }

  const activate = isRecord(body) && body.activate === true;
  if (activate) {
    await upsertActiveAgentPreference(env, {
      userId: identity.scope.userId,
      workspaceId: identity.scope.workspaceId,
      agentId: agent.id,
      reason: "agent-created",
    });
  }

  return json(
    {
      ok: true,
      activeAgentId: activate ? agent.id : identity.agentId,
      agent: toAgentSummary(env, agent, activate ? agent.id : identity.agentId),
    },
    { status: 201 },
  );
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
    agent: toAgentSummary(env, agent, agent.id),
  });
};
