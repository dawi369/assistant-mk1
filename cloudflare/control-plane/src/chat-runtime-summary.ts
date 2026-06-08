import {
  getLatestChatIntent,
  getLatestChatPolicyDecision,
  getLatestChatRun,
  getLatestChatSession,
  toChatIntentSnapshot,
  toChatPolicyDecisionSnapshot,
  toChatRunSnapshot,
  toChatSessionSnapshot,
  toChatThreadSnapshot,
} from "./chat-boundary-store";
import { json, parseDataJson } from "./http";
import { toControlPlaneEventSnapshot } from "./control-plane-events";
import type {
  AgentIdentity,
  ChatRunRow,
  ChatThreadRow,
  ControlPlaneEventRow,
  Env,
  TenantScope,
} from "./types";

type ChatRuntimeState =
  | "no_session"
  | "no_thread"
  | "thread_ready"
  | "blocked"
  | "running"
  | "failed"
  | "completed";

const timingSummary = (latestRun: ChatRunRow | null) => {
  if (!latestRun) return null;
  const metadata = parseDataJson(latestRun.metadata_json);
  const timings = metadata.timings;
  if (!timings || typeof timings !== "object") return null;

  const record = timings as Record<string, unknown>;
  const stageMarks =
    record.stageMarks && typeof record.stageMarks === "object"
      ? (record.stageMarks as Record<string, unknown>)
      : {};

  return {
    firstTokenMs:
      typeof record.firstTokenMs === "number" ? Math.round(record.firstTokenMs) : undefined,
    totalMs: typeof record.totalMs === "number" ? Math.round(record.totalMs) : undefined,
    preStreamMs:
      typeof record.preStreamMs === "number" ? Math.round(record.preStreamMs) : undefined,
    providerMs: typeof record.providerMs === "number" ? Math.round(record.providerMs) : undefined,
    stageMarks: Object.fromEntries(
      Object.entries(stageMarks)
        .filter((entry): entry is [string, number] => typeof entry[1] === "number")
        .map(([key, value]) => [key, Math.round(value)]),
    ),
  };
};

export const latestThreadForSession = async (
  env: Env,
  scope: TenantScope,
  sessionId: string,
  activeThreadId?: string,
) => {
  if (activeThreadId) {
    const activeThread = await env.DB.prepare(
      `SELECT thread_id, session_id, user_id, workspace_id, agent_id, status, upstream_json,
              created_at, updated_at, last_seen_at
       FROM chat_threads
       WHERE user_id = ? AND workspace_id = ? AND session_id = ? AND thread_id = ?
       LIMIT 1`,
    )
      .bind(scope.userId, scope.workspaceId, sessionId, activeThreadId)
      .first<ChatThreadRow>();
    if (activeThread) return activeThread;
  }

  return env.DB.prepare(
    `SELECT thread_id, session_id, user_id, workspace_id, agent_id, status, upstream_json,
            created_at, updated_at, last_seen_at
     FROM chat_threads
     WHERE user_id = ? AND workspace_id = ? AND session_id = ?
     ORDER BY updated_at DESC, created_at DESC
     LIMIT 1`,
  )
    .bind(scope.userId, scope.workspaceId, sessionId)
    .first<ChatThreadRow>();
};

const chatRuntimeEvents = async (env: Env, identity: AgentIdentity, limit = 8) => {
  const events = await env.DB.prepare(
    `SELECT id, user_id, workspace_id, agent_id, type, summary, target_type, target_id,
            data_json, created_at
     FROM control_plane_events
     WHERE user_id = ? AND workspace_id = ? AND type LIKE 'chat.%'
     ORDER BY rowid DESC
     LIMIT ?`,
  )
    .bind(identity.scope.userId, identity.scope.workspaceId, limit)
    .all<ControlPlaneEventRow>();
  return events.results.map(toControlPlaneEventSnapshot);
};

const deriveState = (input: {
  hasSession: boolean;
  hasThread: boolean;
  latestRun: ChatRunRow | null;
  latestPolicyDecision: Awaited<ReturnType<typeof getLatestChatPolicyDecision>>;
}): ChatRuntimeState => {
  if (!input.hasSession) return "no_session";
  if (!input.hasThread) return "no_thread";
  if (input.latestPolicyDecision?.decision === "block" && !input.latestRun) return "blocked";
  if (input.latestRun?.status === "failed" || input.latestRun?.error) return "failed";
  if (input.latestRun?.status === "running") return "running";
  if (input.latestRun?.status === "completed") return "completed";
  return "thread_ready";
};

const failureSummary = (
  state: ChatRuntimeState,
  latestRun: ChatRunRow | null,
  latestPolicyDecision: Awaited<ReturnType<typeof getLatestChatPolicyDecision>>,
) => {
  if (state === "failed" && latestRun) {
    const metadata = parseDataJson(latestRun.metadata_json);
    return {
      source: "chat-run",
      message: latestRun.error ?? "Chat run failed.",
      status: latestRun.status,
      targetId: latestRun.id,
      createdAt: latestRun.updated_at,
      errorCode: typeof metadata.errorCode === "string" ? metadata.errorCode : "runtime_failed",
      retryable: typeof metadata.retryable === "boolean" ? metadata.retryable : true,
    };
  }

  if (state === "blocked" && latestPolicyDecision) {
    const limits = parseDataJson(latestPolicyDecision.limits_json);
    return {
      source: "chat-policy",
      message: latestPolicyDecision.reason,
      status: latestPolicyDecision.decision,
      targetId: latestPolicyDecision.id,
      createdAt: latestPolicyDecision.created_at,
      errorCode: typeof limits.errorCode === "string" ? limits.errorCode : "policy_blocked",
      retryable: typeof limits.retryable === "boolean" ? limits.retryable : false,
    };
  }

  return null;
};

export const getChatRuntimeSummary = async (env: Env, identity: AgentIdentity) => {
  const latestSession = await getLatestChatSession(env, identity.scope);
  const latestThread = latestSession
    ? await latestThreadForSession(
        env,
        identity.scope,
        latestSession.session_id,
        latestSession.active_thread_id ?? undefined,
      )
    : null;

  const [latestRun, latestIntent, latestPolicyDecision, events] = await Promise.all([
    latestThread ? getLatestChatRun(env, identity.scope, latestThread.thread_id) : null,
    latestThread ? getLatestChatIntent(env, identity.scope, latestThread.thread_id) : null,
    latestThread ? getLatestChatPolicyDecision(env, identity.scope, latestThread.thread_id) : null,
    chatRuntimeEvents(env, identity),
  ]);

  const state = deriveState({
    hasSession: Boolean(latestSession),
    hasThread: Boolean(latestThread),
    latestRun,
    latestPolicyDecision,
  });

  return {
    state,
    latestSession: toChatSessionSnapshot(latestSession),
    latestThread: latestThread ? toChatThreadSnapshot(latestThread) : null,
    latestRun: toChatRunSnapshot(latestRun),
    latestIntent: toChatIntentSnapshot(latestIntent),
    latestPolicyDecision: toChatPolicyDecisionSnapshot(latestPolicyDecision),
    timings: timingSummary(latestRun),
    events,
    failure: failureSummary(state, latestRun, latestPolicyDecision),
  };
};

export const handleChatRuntimeSummary = async (env: Env, identity: AgentIdentity) =>
  json({
    ok: true,
    generatedAt: new Date().toISOString(),
    chatRuntime: await getChatRuntimeSummary(env, identity),
  });
