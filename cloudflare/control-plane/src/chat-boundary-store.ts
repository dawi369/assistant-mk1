import { parseDataJson } from "./http";
import {
  createId,
  toJson,
  type AgentIdentity,
  type ChatRunRow,
  type ChatThreadRow,
  type Env,
  type TenantScope,
} from "./types";

type ChatRunStatus = "running" | "completed" | "failed";

export const storeChatThread = async (
  env: Env,
  identity: AgentIdentity,
  threadId: string,
  upstream: Record<string, unknown>,
) => {
  const timestamp = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO chat_threads (
       thread_id, user_id, workspace_id, agent_id, status, upstream_json,
       created_at, updated_at, last_seen_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(thread_id) DO UPDATE SET
       status = excluded.status,
       upstream_json = excluded.upstream_json,
       updated_at = excluded.updated_at,
       last_seen_at = excluded.last_seen_at`,
  )
    .bind(
      threadId,
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.agentId,
      "active",
      toJson(upstream),
      timestamp,
      timestamp,
      timestamp,
    )
    .run();
};

export const touchChatThread = async (env: Env, scope: TenantScope, threadId: string) => {
  const timestamp = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE chat_threads
     SET last_seen_at = ?, updated_at = ?
     WHERE user_id = ? AND workspace_id = ? AND thread_id = ?`,
  )
    .bind(timestamp, timestamp, scope.userId, scope.workspaceId, threadId)
    .run();
};

export const getOwnedChatThread = async (env: Env, scope: TenantScope, threadId: string) =>
  env.DB.prepare(
    `SELECT thread_id, user_id, workspace_id, agent_id, status, upstream_json,
            created_at, updated_at, last_seen_at
     FROM chat_threads
     WHERE user_id = ? AND workspace_id = ? AND thread_id = ?
     LIMIT 1`,
  )
    .bind(scope.userId, scope.workspaceId, threadId)
    .first<ChatThreadRow>();

export const createChatRun = async (env: Env, identity: AgentIdentity, threadId: string) => {
  const timestamp = new Date().toISOString();
  const runId = createId("cf-chat-run");
  await env.DB.prepare(
    `INSERT INTO chat_runs (
       id, thread_id, user_id, workspace_id, agent_id, status, metadata_json,
       started_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      runId,
      threadId,
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.agentId,
      "running",
      "{}",
      timestamp,
      timestamp,
    )
    .run();
  return runId;
};

export const updateChatRun = async (
  env: Env,
  input: {
    runId: string;
    scope: TenantScope;
    status: ChatRunStatus;
    upstreamRunId?: string;
    metadata?: Record<string, unknown>;
    error?: string;
  },
) => {
  const timestamp = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE chat_runs
     SET status = ?,
         upstream_run_id = COALESCE(?, upstream_run_id),
         metadata_json = ?,
         error = ?,
         completed_at = CASE WHEN ? = 'completed' THEN ? ELSE completed_at END,
         failed_at = CASE WHEN ? = 'failed' THEN ? ELSE failed_at END,
         updated_at = ?
     WHERE user_id = ? AND workspace_id = ? AND id = ?`,
  )
    .bind(
      input.status,
      input.upstreamRunId ?? null,
      toJson(input.metadata ?? {}),
      input.error ?? null,
      input.status,
      timestamp,
      input.status,
      timestamp,
      timestamp,
      input.scope.userId,
      input.scope.workspaceId,
      input.runId,
    )
    .run();
};

export const getLatestChatRun = async (env: Env, scope: TenantScope, threadId: string) =>
  env.DB.prepare(
    `SELECT id, thread_id, user_id, workspace_id, agent_id, upstream_run_id, status,
            metadata_json, error, started_at, completed_at, failed_at, updated_at
     FROM chat_runs
     WHERE user_id = ? AND workspace_id = ? AND thread_id = ?
     ORDER BY updated_at DESC, started_at DESC
     LIMIT 1`,
  )
    .bind(scope.userId, scope.workspaceId, threadId)
    .first<ChatRunRow>();

export const toChatThreadSnapshot = (row: ChatThreadRow) => ({
  threadId: row.thread_id,
  scope: {
    userId: row.user_id,
    workspaceId: row.workspace_id,
  },
  agentId: row.agent_id,
  status: row.status,
  upstream: parseDataJson(row.upstream_json),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  lastSeenAt: row.last_seen_at,
});

export const toChatRunSnapshot = (row: ChatRunRow | null) =>
  row
    ? {
        id: row.id,
        threadId: row.thread_id,
        scope: {
          userId: row.user_id,
          workspaceId: row.workspace_id,
        },
        agentId: row.agent_id,
        upstreamRunId: row.upstream_run_id ?? undefined,
        status: row.status,
        metadata: parseDataJson(row.metadata_json),
        error: row.error ?? undefined,
        startedAt: row.started_at,
        completedAt: row.completed_at ?? undefined,
        failedAt: row.failed_at ?? undefined,
        updatedAt: row.updated_at,
      }
    : null;
