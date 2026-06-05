import { json, parseJson } from "./http";
import type { AgentIdentity, AgentRow, Env, MembershipRow, UserRow, WorkspaceRow } from "./types";

const authModeHeader = "x-assistant-mk1-auth-mode";
const workspaceSourceHeader = "x-assistant-mk1-workspace-source";

const readOptionalHeader = (request: Request, name: string) =>
  request.headers.get(name)?.trim() || undefined;

const parseStringArray = (raw: string) => {
  const parsed = parseJson(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is string => typeof item === "string");
};

const selectUser = (env: Env, userId: string) =>
  env.DB.prepare(
    `SELECT id, email, display_name, status, data_json, created_at, updated_at
     FROM users
     WHERE id = ?
     LIMIT 1`,
  )
    .bind(userId)
    .first<UserRow>();

const selectWorkspace = (env: Env, workspaceId: string) =>
  env.DB.prepare(
    `SELECT id, name, status, created_by_user_id, data_json, created_at, updated_at
     FROM workspaces
     WHERE id = ?
     LIMIT 1`,
  )
    .bind(workspaceId)
    .first<WorkspaceRow>();

const selectMembership = (env: Env, userId: string, workspaceId: string) =>
  env.DB.prepare(
    `SELECT id, user_id, workspace_id, role, status, roles_json, permissions_json,
            data_json, created_at, updated_at
     FROM memberships
     WHERE user_id = ? AND workspace_id = ?
     LIMIT 1`,
  )
    .bind(userId, workspaceId)
    .first<MembershipRow>();

const selectAgent = (env: Env, agentId: string, workspaceId: string) =>
  env.DB.prepare(
    `SELECT id, workspace_id, name, description, status, is_default, created_by_user_id,
            data_json, created_at, updated_at
     FROM agents
     WHERE id = ? AND workspace_id = ?
     LIMIT 1`,
  )
    .bind(agentId, workspaceId)
    .first<AgentRow>();

export const handleWorkspaceContext = async (
  request: Request,
  env: Env,
  identity: AgentIdentity,
) => {
  const [user, workspace, membership, agent] = await Promise.all([
    selectUser(env, identity.scope.userId),
    selectWorkspace(env, identity.scope.workspaceId),
    selectMembership(env, identity.scope.userId, identity.scope.workspaceId),
    selectAgent(env, identity.agentId, identity.scope.workspaceId),
  ]);

  return json({
    ok: true,
    context: {
      identity: {
        userId: identity.scope.userId,
        workspaceId: identity.scope.workspaceId,
        agentId: identity.agentId,
        authMode: readOptionalHeader(request, authModeHeader) ?? "unknown",
        workspaceSource: readOptionalHeader(request, workspaceSourceHeader) ?? "unknown",
      },
      user: user
        ? {
            id: user.id,
            email: user.email,
            displayName: user.display_name,
            status: user.status,
          }
        : null,
      workspace: workspace
        ? {
            id: workspace.id,
            name: workspace.name,
            status: workspace.status,
          }
        : null,
      membership: membership
        ? {
            role: membership.role,
            status: membership.status,
            roles: parseStringArray(membership.roles_json),
            permissions: parseStringArray(membership.permissions_json),
          }
        : null,
      agent: agent
        ? {
            id: agent.id,
            name: agent.name,
            status: agent.status,
            isDefault: agent.is_default === 1,
          }
        : null,
    },
  });
};
