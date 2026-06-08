import { getOwnedChatThread } from "./chat-boundary-store";
import { json, parseDataJson } from "./http";
import type { AgentIdentity, ChatThreadRow, Env } from "./types";

type ChatThreadListRow = ChatThreadRow & {
  active_thread_id: string | null;
  latest_run_status: string | null;
};

const limitFromUrl = (url: URL) => {
  const raw = Number(url.searchParams.get("limit") ?? 30);
  if (!Number.isFinite(raw)) return 30;
  return Math.max(1, Math.min(Math.trunc(raw), 50));
};

const firstUserMessageTitle = (thread: ChatThreadRow) => {
  const upstream = parseDataJson(thread.upstream_json);
  const messages = Array.isArray(upstream.messages) ? upstream.messages : [];
  const firstUser = messages.find((message) => {
    if (!message || typeof message !== "object") return false;
    const type = "type" in message ? message.type : "role" in message ? message.role : undefined;
    return type === "human" || type === "user";
  });
  if (!firstUser || typeof firstUser !== "object" || !("content" in firstUser)) {
    return "New chat";
  }

  const content = firstUser.content;
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .map((part) => {
              if (!part || typeof part !== "object") return "";
              if ("text" in part && typeof part.text === "string") return part.text;
              if ("content" in part && typeof part.content === "string") return part.content;
              return "";
            })
            .filter(Boolean)
            .join(" ")
        : "";
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return "New chat";
  return compact.length > 56 ? `${compact.slice(0, 53)}...` : compact;
};

const messageCount = (thread: ChatThreadRow) => {
  const upstream = parseDataJson(thread.upstream_json);
  return Array.isArray(upstream.messages) ? upstream.messages.length : 0;
};

const toThreadSummary = (
  thread: ChatThreadRow,
  input: { activeThreadId?: string | null; latestRunStatus?: string | null } = {},
) => ({
  threadId: thread.thread_id,
  sessionId: thread.session_id,
  agentId: thread.agent_id,
  status: thread.status,
  title: firstUserMessageTitle(thread),
  createdAt: thread.created_at,
  updatedAt: thread.updated_at,
  lastSeenAt: thread.last_seen_at,
  isActive: input.activeThreadId === thread.thread_id,
  latestRunStatus: input.latestRunStatus ?? undefined,
  messageCount: messageCount(thread),
});

const activeThreadForAgent = async (env: Env, identity: AgentIdentity) =>
  env.DB.prepare(
    `SELECT active_thread_id
     FROM chat_sessions
     WHERE user_id = ? AND workspace_id = ? AND agent_id = ?
     ORDER BY updated_at DESC, created_at DESC
     LIMIT 1`,
  )
    .bind(identity.scope.userId, identity.scope.workspaceId, identity.agentId)
    .first<{ active_thread_id: string | null }>();

export const handleListChatThreads = async (env: Env, identity: AgentIdentity, url: URL) => {
  const [activeSession, threads] = await Promise.all([
    activeThreadForAgent(env, identity),
    env.DB.prepare(
      `SELECT t.thread_id, t.session_id, t.user_id, t.workspace_id, t.agent_id, t.status,
              t.upstream_json, t.created_at, t.updated_at, t.last_seen_at,
              (
                SELECT r.status
                FROM chat_runs r
                WHERE r.user_id = t.user_id
                  AND r.workspace_id = t.workspace_id
                  AND r.thread_id = t.thread_id
                ORDER BY r.updated_at DESC, r.started_at DESC
                LIMIT 1
              ) AS latest_run_status
       FROM chat_threads t
       WHERE t.user_id = ? AND t.workspace_id = ? AND t.agent_id = ?
       ORDER BY t.updated_at DESC, t.created_at DESC
       LIMIT ?`,
    )
      .bind(identity.scope.userId, identity.scope.workspaceId, identity.agentId, limitFromUrl(url))
      .all<ChatThreadListRow>(),
  ]);

  return json({
    ok: true,
    threads: threads.results.map((thread) =>
      toThreadSummary(thread, {
        activeThreadId: activeSession?.active_thread_id,
        latestRunStatus: thread.latest_run_status,
      }),
    ),
  });
};

export const handleGetChatThread = async (env: Env, identity: AgentIdentity, threadId: string) => {
  const thread = await getOwnedChatThread(env, identity.scope, threadId);
  if (!thread || thread.agent_id !== identity.agentId) {
    return json({ ok: false, error: "Thread not found" }, { status: 404 });
  }

  const activeSession = await activeThreadForAgent(env, identity);
  return json({
    ok: true,
    thread: toThreadSummary(thread, { activeThreadId: activeSession?.active_thread_id }),
  });
};
