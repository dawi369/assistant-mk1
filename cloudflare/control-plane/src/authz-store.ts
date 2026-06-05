import type { AgentRow, Env, MembershipRow, UserRow, WorkspaceRow } from "./types";

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
    `SELECT id, name, status, created_by_user_id, data_json, created_at, updated_at
     FROM workspaces
     WHERE id = ?
     LIMIT 1`,
  )
    .bind(workspaceId)
    .first<WorkspaceRow>();

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
