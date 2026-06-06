import {
  createDefaultAgentIfMissing,
  insertWorkspace,
  upsertActiveAgentPreference,
  upsertActiveWorkspacePreference,
  upsertMembership,
} from "./authz";
import {
  selectAccountWorkspacesForUser,
  selectActiveAgentPreference,
  selectAgent,
  selectDefaultAgent,
  selectMembership,
  selectWorkspace,
} from "./authz-store";
import { isRecord, json, parseJson } from "./http";
import { requireActiveMembership, requireAdminMembership } from "./membership-policy";
import { type AgentIdentity, type Env, type WorkspaceRow } from "./types";

const workspaceNameMaxLength = 80;

const requireAccountIdentity = (
  identity: AgentIdentity,
): { ok: true; accountId: string; accountSource: string } | { ok: false; response: Response } => {
  if (!identity.accountId || !identity.accountSource) {
    return {
      ok: false,
      response: json(
        { ok: false, error: "Account identity is required for workspace management" },
        { status: 400 },
      ),
    };
  }
  return {
    ok: true,
    accountId: identity.accountId,
    accountSource: identity.accountSource,
  };
};

const parseStringArray = (raw: string) => {
  const parsed = parseJson(raw || "[]");
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is string => typeof item === "string");
};

const workspaceId = (accountId: string) => `workspace:${accountId}:${crypto.randomUUID()}`;

const toWorkspaceSummary = (row: WorkspaceRow, activeWorkspaceId: string) => ({
  id: row.id,
  name: row.name,
  status: row.status,
  isDefault: row.is_default === 1,
  isActive: row.id === activeWorkspaceId,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toAgentSummary = (row: Awaited<ReturnType<typeof selectDefaultAgent>>) =>
  row
    ? {
        id: row.id,
        name: row.name,
        status: row.status,
        isDefault: row.is_default === 1,
      }
    : null;

const selectActiveAgentForWorkspace = async (
  env: Env,
  input: { userId: string; workspaceId: string },
) => {
  const preference = await selectActiveAgentPreference(env, input);
  if (preference) {
    const preferredAgent = await selectAgent(env, preference.agent_id, input.workspaceId);
    return preferredAgent?.status === "active" ? preferredAgent : null;
  }

  const defaultAgent = await selectDefaultAgent(env, input.workspaceId);
  if (!defaultAgent || defaultAgent.status !== "active") return null;

  await upsertActiveAgentPreference(env, {
    userId: input.userId,
    workspaceId: input.workspaceId,
    agentId: defaultAgent.id,
    reason: "default-bootstrap",
  });
  return defaultAgent;
};

export const handleListWorkspaces = async (env: Env, identity: AgentIdentity) => {
  const account = requireAccountIdentity(identity);
  if (!account.ok) return account.response;

  const workspaces = await selectAccountWorkspacesForUser(env, {
    userId: identity.scope.userId,
    accountId: account.accountId,
  });

  return json({
    ok: true,
    account: {
      id: account.accountId,
      source: account.accountSource,
    },
    activeWorkspaceId: identity.scope.workspaceId,
    workspaces: workspaces.results.map((workspace) =>
      toWorkspaceSummary(workspace, identity.scope.workspaceId),
    ),
  });
};

export const handleCreateWorkspace = async (
  request: Request,
  env: Env,
  identity: AgentIdentity,
) => {
  const account = requireAccountIdentity(identity);
  if (!account.ok) return account.response;

  const body = parseJson(await request.text());
  const rawName = isRecord(body) && typeof body.name === "string" ? body.name.trim() : "";
  const name = rawName.slice(0, workspaceNameMaxLength);

  if (!name) {
    return json({ ok: false, error: "Workspace name is required" }, { status: 400 });
  }

  const currentMembership = await selectMembership(
    env,
    identity.scope.userId,
    identity.scope.workspaceId,
  );
  const adminError = requireAdminMembership(currentMembership);
  if (adminError) return adminError;
  if (!currentMembership) {
    return json({ ok: false, error: "Workspace membership is not active" }, { status: 403 });
  }

  const id = workspaceId(account.accountId);
  await insertWorkspace(env, {
    workspaceId: id,
    accountId: account.accountId,
    accountSource: account.accountSource,
    userId: identity.scope.userId,
    name,
  });
  await upsertMembership(env, {
    userId: identity.scope.userId,
    workspaceId: id,
    role: currentMembership.role,
    roles: parseStringArray(currentMembership.roles_json),
    permissions: parseStringArray(currentMembership.permissions_json),
  });
  await createDefaultAgentIfMissing(env, {
    userId: identity.scope.userId,
    workspaceId: id,
  });
  await upsertActiveWorkspacePreference(env, {
    userId: identity.scope.userId,
    accountId: account.accountId,
    workspaceId: id,
    reason: "workspace-created",
  });

  const [workspace, defaultAgent] = await Promise.all([
    selectWorkspace(env, id),
    selectDefaultAgent(env, id),
  ]);
  if (defaultAgent) {
    await upsertActiveAgentPreference(env, {
      userId: identity.scope.userId,
      workspaceId: id,
      agentId: defaultAgent.id,
      reason: "workspace-created",
    });
  }

  return json(
    {
      ok: true,
      activeWorkspaceId: id,
      workspace: workspace ? toWorkspaceSummary(workspace, id) : null,
      defaultAgent: toAgentSummary(defaultAgent),
    },
    { status: 201 },
  );
};

export const handleActivateWorkspace = async (
  env: Env,
  identity: AgentIdentity,
  workspaceIdToActivate: string,
) => {
  const account = requireAccountIdentity(identity);
  if (!account.ok) return account.response;

  const workspace = await selectWorkspace(env, workspaceIdToActivate);
  if (!workspace || workspace.account_id !== account.accountId) {
    return json({ ok: false, error: "Workspace not found" }, { status: 404 });
  }
  if (workspace.status !== "active") {
    return json({ ok: false, error: "Workspace is not active" }, { status: 403 });
  }

  const currentMembership = await selectMembership(
    env,
    identity.scope.userId,
    identity.scope.workspaceId,
  );
  const adminError = requireAdminMembership(currentMembership);
  if (adminError) return adminError;

  const membership = await selectMembership(env, identity.scope.userId, workspaceIdToActivate);
  const activeTargetError = requireActiveMembership(membership);
  if (activeTargetError) return activeTargetError;

  const activeAgent = await selectActiveAgentForWorkspace(env, {
    userId: identity.scope.userId,
    workspaceId: workspaceIdToActivate,
  });
  if (!activeAgent) {
    return json({ ok: false, error: "Active agent not found" }, { status: 403 });
  }

  await upsertActiveWorkspacePreference(env, {
    userId: identity.scope.userId,
    accountId: account.accountId,
    workspaceId: workspaceIdToActivate,
    reason: "workspace-activated",
  });

  return json({
    ok: true,
    activeWorkspaceId: workspaceIdToActivate,
    workspace: toWorkspaceSummary(workspace, workspaceIdToActivate),
    agent: {
      id: activeAgent.id,
      name: activeAgent.name,
      status: activeAgent.status,
      isDefault: activeAgent.is_default === 1,
    },
  });
};
