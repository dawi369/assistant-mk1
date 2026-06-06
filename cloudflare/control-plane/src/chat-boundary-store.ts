import { parseDataJson } from "./http";
import {
  createId,
  toJson,
  type AgentIdentity,
  type ChatIntentRow,
  type ChatPolicyDecisionRow,
  type ChatRunRow,
  type ChatSessionRow,
  type ChatThreadRow,
  type Env,
  type ExecutionMode,
  type TenantScope,
} from "./types";

type ChatRunStatus = "running" | "completed" | "failed";

export const createChatSession = async (
  env: Env,
  identity: AgentIdentity,
  metadata: Record<string, unknown> = {},
) => {
  const timestamp = new Date().toISOString();
  const sessionId = createId("cf-session");
  await env.DB.prepare(
    `INSERT INTO chat_sessions (
       session_id, user_id, workspace_id, agent_id, status, metadata_json,
       created_at, updated_at, last_seen_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      sessionId,
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.agentId,
      "active",
      toJson(metadata),
      timestamp,
      timestamp,
      timestamp,
    )
    .run();
  return sessionId;
};

export const getOwnedChatSession = async (env: Env, scope: TenantScope, sessionId: string) =>
  env.DB.prepare(
    `SELECT session_id, user_id, workspace_id, agent_id, status, active_thread_id,
            metadata_json, created_at, updated_at, last_seen_at
     FROM chat_sessions
     WHERE user_id = ? AND workspace_id = ? AND session_id = ?
     LIMIT 1`,
  )
    .bind(scope.userId, scope.workspaceId, sessionId)
    .first<ChatSessionRow>();

export const getLatestChatSession = async (env: Env, scope: TenantScope) =>
  env.DB.prepare(
    `SELECT session_id, user_id, workspace_id, agent_id, status, active_thread_id,
            metadata_json, created_at, updated_at, last_seen_at
     FROM chat_sessions
     WHERE user_id = ? AND workspace_id = ?
     ORDER BY updated_at DESC, created_at DESC
     LIMIT 1`,
  )
    .bind(scope.userId, scope.workspaceId)
    .first<ChatSessionRow>();

export const getOrCreateLatestChatSession = async (env: Env, identity: AgentIdentity) => {
  const latest = await getLatestChatSession(env, identity.scope);
  return (
    latest?.session_id ??
    (await createChatSession(env, identity, { source: "cloudflare-chat-runtime" }))
  );
};

export const touchChatSession = async (
  env: Env,
  scope: TenantScope,
  sessionId: string,
  activeThreadId?: string,
) => {
  const timestamp = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE chat_sessions
     SET active_thread_id = COALESCE(?, active_thread_id),
         last_seen_at = ?,
         updated_at = ?
     WHERE user_id = ? AND workspace_id = ? AND session_id = ?`,
  )
    .bind(activeThreadId ?? null, timestamp, timestamp, scope.userId, scope.workspaceId, sessionId)
    .run();
};

export const storeChatThread = async (
  env: Env,
  identity: AgentIdentity,
  sessionId: string,
  threadId: string,
  upstream: Record<string, unknown>,
) => {
  const timestamp = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO chat_threads (
       thread_id, session_id, user_id, workspace_id, agent_id, status, upstream_json,
       created_at, updated_at, last_seen_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(thread_id) DO UPDATE SET
       session_id = excluded.session_id,
       status = excluded.status,
       upstream_json = excluded.upstream_json,
       updated_at = excluded.updated_at,
       last_seen_at = excluded.last_seen_at`,
  )
    .bind(
      threadId,
      sessionId,
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

export const updateChatThreadUpstream = async (
  env: Env,
  scope: TenantScope,
  threadId: string,
  upstream: Record<string, unknown>,
) => {
  const timestamp = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE chat_threads
     SET upstream_json = ?,
         updated_at = ?,
         last_seen_at = ?
     WHERE user_id = ? AND workspace_id = ? AND thread_id = ?`,
  )
    .bind(toJson(upstream), timestamp, timestamp, scope.userId, scope.workspaceId, threadId)
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
    `SELECT thread_id, session_id, user_id, workspace_id, agent_id, status, upstream_json,
            created_at, updated_at, last_seen_at
     FROM chat_threads
     WHERE user_id = ? AND workspace_id = ? AND thread_id = ?
     LIMIT 1`,
  )
    .bind(scope.userId, scope.workspaceId, threadId)
    .first<ChatThreadRow>();

export const createChatIntent = async (
  env: Env,
  identity: AgentIdentity,
  input: {
    sessionId: string;
    threadId: string;
    executionMode: ExecutionMode;
    status: "allowed" | "blocked";
    payload: Record<string, unknown>;
  },
) => {
  const timestamp = new Date().toISOString();
  const intentId = createId("cf-chat-intent");
  await env.DB.prepare(
    `INSERT INTO chat_intents (
       id, session_id, thread_id, user_id, workspace_id, agent_id, type, execution_mode,
       status, payload_json, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      intentId,
      input.sessionId,
      input.threadId,
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.agentId,
      "chat.respond",
      input.executionMode,
      input.status,
      toJson(input.payload),
      timestamp,
      timestamp,
    )
    .run();
  return intentId;
};

export const createChatPolicyDecision = async (
  env: Env,
  identity: AgentIdentity,
  input: {
    intentId: string;
    threadId: string;
    decision: "allow" | "block";
    reason: string;
    executionMode: ExecutionMode;
    limits?: Record<string, unknown>;
  },
) => {
  const timestamp = new Date().toISOString();
  const decisionId = createId("cf-chat-policy");
  await env.DB.prepare(
    `INSERT INTO chat_policy_decisions (
       id, intent_id, thread_id, user_id, workspace_id, agent_id, decision, reason,
       execution_mode, limits_json, created_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      decisionId,
      input.intentId,
      input.threadId,
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.agentId,
      input.decision,
      input.reason,
      input.executionMode,
      toJson(input.limits ?? {}),
      timestamp,
    )
    .run();
  return decisionId;
};

export const createChatRun = async (
  env: Env,
  identity: AgentIdentity,
  input: {
    threadId: string;
    intentId: string;
    policyDecisionId: string;
    metadata?: Record<string, unknown>;
  },
) => {
  const timestamp = new Date().toISOString();
  const runId = createId("cf-chat-run");
  await env.DB.prepare(
    `INSERT INTO chat_runs (
       id, intent_id, policy_decision_id, thread_id, user_id, workspace_id, agent_id,
       status, metadata_json,
       started_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      runId,
      input.intentId,
      input.policyDecisionId,
      input.threadId,
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.agentId,
      "running",
      toJson(input.metadata ?? {}),
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
  const existing = await env.DB.prepare(
    `SELECT metadata_json
     FROM chat_runs
     WHERE user_id = ? AND workspace_id = ? AND id = ?
     LIMIT 1`,
  )
    .bind(input.scope.userId, input.scope.workspaceId, input.runId)
    .first<{ metadata_json: string }>();
  const existingMetadata = parseDataJson(existing?.metadata_json ?? "{}");
  const metadata = input.metadata ? { ...existingMetadata, ...input.metadata } : existingMetadata;

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
      toJson(metadata),
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
    `SELECT id, intent_id, policy_decision_id, thread_id, user_id, workspace_id, agent_id,
            upstream_run_id, status, metadata_json, error, started_at, completed_at,
            failed_at, updated_at
     FROM chat_runs
     WHERE user_id = ? AND workspace_id = ? AND thread_id = ?
     ORDER BY updated_at DESC, started_at DESC
     LIMIT 1`,
  )
    .bind(scope.userId, scope.workspaceId, threadId)
    .first<ChatRunRow>();

export const getLatestRunningChatRun = async (env: Env, scope: TenantScope, threadId: string) =>
  env.DB.prepare(
    `SELECT id, intent_id, policy_decision_id, thread_id, user_id, workspace_id, agent_id,
            upstream_run_id, status, metadata_json, error, started_at, completed_at,
            failed_at, updated_at
     FROM chat_runs
     WHERE user_id = ? AND workspace_id = ? AND thread_id = ? AND status = 'running'
     ORDER BY updated_at DESC, started_at DESC
     LIMIT 1`,
  )
    .bind(scope.userId, scope.workspaceId, threadId)
    .first<ChatRunRow>();

export const getLatestChatIntent = async (env: Env, scope: TenantScope, threadId: string) =>
  env.DB.prepare(
    `SELECT id, session_id, thread_id, user_id, workspace_id, agent_id, type,
            execution_mode, status, payload_json, created_at, updated_at
     FROM chat_intents
     WHERE user_id = ? AND workspace_id = ? AND thread_id = ?
     ORDER BY updated_at DESC, created_at DESC
     LIMIT 1`,
  )
    .bind(scope.userId, scope.workspaceId, threadId)
    .first<ChatIntentRow>();

export const getLatestChatPolicyDecision = async (env: Env, scope: TenantScope, threadId: string) =>
  env.DB.prepare(
    `SELECT id, intent_id, thread_id, user_id, workspace_id, agent_id, decision,
            reason, execution_mode, limits_json, created_at
     FROM chat_policy_decisions
     WHERE user_id = ? AND workspace_id = ? AND thread_id = ?
     ORDER BY created_at DESC
     LIMIT 1`,
  )
    .bind(scope.userId, scope.workspaceId, threadId)
    .first<ChatPolicyDecisionRow>();

export const toChatThreadSnapshot = (row: ChatThreadRow) => ({
  threadId: row.thread_id,
  sessionId: row.session_id,
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
        intentId: row.intent_id,
        policyDecisionId: row.policy_decision_id,
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

export const toChatIntentSnapshot = (row: ChatIntentRow | null) =>
  row
    ? {
        id: row.id,
        sessionId: row.session_id,
        threadId: row.thread_id,
        scope: {
          userId: row.user_id,
          workspaceId: row.workspace_id,
        },
        agentId: row.agent_id,
        type: row.type,
        executionMode: row.execution_mode,
        status: row.status,
        payload: parseDataJson(row.payload_json),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }
    : null;

export const toChatPolicyDecisionSnapshot = (row: ChatPolicyDecisionRow | null) =>
  row
    ? {
        id: row.id,
        intentId: row.intent_id,
        threadId: row.thread_id,
        scope: {
          userId: row.user_id,
          workspaceId: row.workspace_id,
        },
        agentId: row.agent_id,
        decision: row.decision,
        reason: row.reason,
        executionMode: row.execution_mode,
        limits: parseDataJson(row.limits_json),
        createdAt: row.created_at,
      }
    : null;

export const toChatSessionSnapshot = (row: ChatSessionRow | null) =>
  row
    ? {
        sessionId: row.session_id,
        scope: {
          userId: row.user_id,
          workspaceId: row.workspace_id,
        },
        agentId: row.agent_id,
        status: row.status,
        activeThreadId: row.active_thread_id ?? undefined,
        metadata: parseDataJson(row.metadata_json),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        lastSeenAt: row.last_seen_at,
      }
    : null;
