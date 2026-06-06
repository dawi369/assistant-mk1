import type {
  ActiveWorkspacePreferenceRow,
  AgentRow,
  Env,
  MembershipRow,
  UserRow,
  WorkspaceRow,
} from "./types";

export const selectUser = (env: Env, userId: string) =>
  env.DB.prepare(
    `SELECT id, email, display_name, status, data_json, created_at, updated_at
     FROM users
     WHERE id = ?
     LIMIT 1`,
  )
    .bind(userId)
    .first<UserRow>();

export const selectWorkspace = (env: Env, workspaceId: string) =>
  env.DB.prepare(
    `SELECT id, account_id, account_source, name, status, is_default,
            created_by_user_id, data_json, created_at, updated_at
     FROM workspaces
     WHERE id = ?
     LIMIT 1`,
  )
    .bind(workspaceId)
    .first<WorkspaceRow>();

export const selectDefaultWorkspaceForAccount = (env: Env, accountId: string) =>
  env.DB.prepare(
    `SELECT id, account_id, account_source, name, status, is_default,
            created_by_user_id, data_json, created_at, updated_at
     FROM workspaces
     WHERE account_id = ? AND is_default = 1
     LIMIT 1`,
  )
    .bind(accountId)
    .first<WorkspaceRow>();

export const selectActiveWorkspacePreference = (
  env: Env,
  input: { userId: string; accountId: string },
) =>
  env.DB.prepare(
    `SELECT user_id, account_id, workspace_id, data_json, created_at, updated_at
     FROM active_workspace_preferences
     WHERE user_id = ? AND account_id = ?
     LIMIT 1`,
  )
    .bind(input.userId, input.accountId)
    .first<ActiveWorkspacePreferenceRow>();

export const selectAccountWorkspacesForUser = (
  env: Env,
  input: { userId: string; accountId: string },
) =>
  env.DB.prepare(
    `SELECT workspaces.id, workspaces.account_id, workspaces.account_source,
            workspaces.name, workspaces.status, workspaces.is_default,
            workspaces.created_by_user_id, workspaces.data_json, workspaces.created_at,
            workspaces.updated_at
     FROM workspaces
     INNER JOIN memberships ON memberships.workspace_id = workspaces.id
     WHERE workspaces.account_id = ? AND memberships.user_id = ? AND memberships.status = 'active'
     ORDER BY workspaces.is_default DESC, workspaces.updated_at DESC, workspaces.created_at DESC`,
  )
    .bind(input.accountId, input.userId)
    .all<WorkspaceRow>();

export const selectMembership = (env: Env, userId: string, workspaceId: string) =>
  env.DB.prepare(
    `SELECT id, user_id, workspace_id, role, status, roles_json, permissions_json,
            data_json, created_at, updated_at
     FROM memberships
     WHERE user_id = ? AND workspace_id = ?
     LIMIT 1`,
  )
    .bind(userId, workspaceId)
    .first<MembershipRow>();

export const selectDefaultAgent = (env: Env, workspaceId: string) =>
  env.DB.prepare(
    `SELECT id, workspace_id, name, description, status, is_default, created_by_user_id,
            data_json, created_at, updated_at
     FROM agents
     WHERE workspace_id = ? AND is_default = 1
     LIMIT 1`,
  )
    .bind(workspaceId)
    .first<AgentRow>();

export const selectAgent = (env: Env, agentId: string, workspaceId: string) =>
  env.DB.prepare(
    `SELECT id, workspace_id, name, description, status, is_default, created_by_user_id,
            data_json, created_at, updated_at
     FROM agents
     WHERE id = ? AND workspace_id = ?
     LIMIT 1`,
  )
    .bind(agentId, workspaceId)
    .first<AgentRow>();

export const selectWorkspaceAgents = (env: Env, workspaceId: string) =>
  env.DB.prepare(
    `SELECT id, workspace_id, name, description, status, is_default, created_by_user_id,
            data_json, created_at, updated_at
     FROM agents
     WHERE workspace_id = ?
     ORDER BY is_default DESC, updated_at DESC, created_at DESC`,
  )
    .bind(workspaceId)
    .all<AgentRow>();
