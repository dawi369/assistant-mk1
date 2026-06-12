import { toAgentSummary } from "./agent-records";
import { signAgentConnectionClaims } from "./agent-connection-token";
import { upsertActiveAgentPreference } from "./authz";
import { selectAgent, selectWorkspace } from "./authz-store";
import { getOrCreateThreadAgentConnectionContext } from "./chat-agent-connection-context";
import { getOwnedChatThread } from "./chat-boundary-store";
import { json, parseDataJson } from "./http";
import type { AgentIdentity, AgentRow, ChatThreadRow, Env } from "./types";

type ChatThreadListRow = ChatThreadRow & {
  latest_run_status: string | null;
  agent_name: string | null;
  agent_description: string | null;
  agent_status: string | null;
  agent_is_default: number | null;
  agent_created_by_user_id: string | null;
  agent_data_json: string | null;
  agent_created_at: string | null;
  agent_updated_at: string | null;
};

const tokenTtlSeconds = 5 * 60;

const getRequiredSecret = (env: Env) => {
  const secret = env.WORKBENCH_AGENT_CONNECTION_SECRET?.trim();
  if (!secret) throw new Error("WORKBENCH_AGENT_CONNECTION_SECRET is not configured");
  return secret;
};

const agentHostFromRequest = (request: Request) => {
  const url = new URL(request.url);
  return url.origin;
};

const firstUserMessageTitle = (thread: ChatThreadRow) => {
  const upstream = parseDataJson(thread.upstream_json);
  if (typeof upstream.title === "string" && upstream.title.trim()) return upstream.title.trim();
  const messages = Array.isArray(upstream.messages) ? upstream.messages : [];
  const firstUser = messages.find((message) => {
    if (!message || typeof message !== "object") return false;
    const type = "type" in message ? message.type : "role" in message ? message.role : undefined;
    return type === "human" || type === "user";
  });
  if (!firstUser || typeof firstUser !== "object" || !("content" in firstUser)) return "New chat";

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
  if (typeof upstream.messageCount === "number" && Number.isFinite(upstream.messageCount)) {
    return upstream.messageCount;
  }
  return Array.isArray(upstream.messages) ? upstream.messages.length : 0;
};

const rowAgent = (row: ChatThreadListRow): AgentRow | null => {
  if (!row.agent_name || !row.agent_status) return null;
  return {
    id: row.agent_id,
    workspace_id: row.workspace_id,
    name: row.agent_name,
    description: row.agent_description,
    status: row.agent_status,
    is_default: row.agent_is_default ?? 0,
    created_by_user_id: row.agent_created_by_user_id ?? row.user_id,
    data_json: row.agent_data_json ?? "{}",
    created_at: row.agent_created_at ?? row.created_at,
    updated_at: row.agent_updated_at ?? row.updated_at,
  };
};

const toThreadSummary = (
  env: Env,
  thread: ChatThreadListRow,
  input: { activeThreadId?: string | null; activeAgentId: string },
) => {
  const agent = rowAgent(thread);
  return {
    threadId: thread.thread_id,
    sessionId: thread.session_id,
    agentId: thread.agent_id,
    agent: agent ? toAgentSummary(env, agent, input.activeAgentId) : null,
    status: thread.status,
    title: firstUserMessageTitle(thread),
    createdAt: thread.created_at,
    updatedAt: thread.updated_at,
    lastSeenAt: thread.last_seen_at,
    isActive: input.activeThreadId === thread.thread_id,
    latestRunStatus: thread.latest_run_status ?? undefined,
    messageCount: messageCount(thread),
  };
};

const listWorkspaceThreads = async (env: Env, identity: AgentIdentity, activeThreadId?: string) => {
  const threads = await env.DB.prepare(
    `SELECT t.thread_id, t.session_id, t.user_id, t.workspace_id, t.agent_id, t.status,
            t.upstream_json, t.created_at, t.updated_at, t.last_seen_at,
            a.name AS agent_name,
            a.description AS agent_description,
            a.status AS agent_status,
            a.is_default AS agent_is_default,
            a.created_by_user_id AS agent_created_by_user_id,
            a.data_json AS agent_data_json,
            a.created_at AS agent_created_at,
            a.updated_at AS agent_updated_at,
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
     LEFT JOIN agents a ON a.id = t.agent_id AND a.workspace_id = t.workspace_id
     WHERE t.user_id = ? AND t.workspace_id = ?
     ORDER BY t.updated_at DESC, t.created_at DESC
     LIMIT 30`,
  )
    .bind(identity.scope.userId, identity.scope.workspaceId)
    .all<ChatThreadListRow>();

  return threads.results.map((thread) =>
    toThreadSummary(env, thread, {
      activeThreadId,
      activeAgentId: identity.agentId,
    }),
  );
};

const buildSessionResponse = async (
  request: Request,
  env: Env,
  identity: AgentIdentity,
  options?: { fresh?: boolean; threadId?: string },
) => {
  const context = await getOrCreateThreadAgentConnectionContext(env, identity, options);
  if (!context) return null;

  const [workspace, activeAgent] = await Promise.all([
    selectWorkspace(env, identity.scope.workspaceId),
    selectAgent(env, context.agentId, identity.scope.workspaceId),
  ]);
  if (!activeAgent || activeAgent.status !== "active") {
    return json({ ok: false, error: "Agent is not active" }, { status: 403 });
  }

  const expiresAtSeconds = Math.floor(Date.now() / 1000) + tokenTtlSeconds;
  const token = await signAgentConnectionClaims(getRequiredSecret(env), {
    v: 1,
    exp: expiresAtSeconds,
    nonce: crypto.randomUUID(),
    userId: identity.scope.userId,
    accountId: context.accountId,
    accountSource: context.accountSource,
    workspaceId: context.workspaceId,
    agentId: context.agentId,
    agentUpdatedAt: context.agentUpdatedAt,
    threadId: context.threadId,
    sessionId: context.sessionId,
    instanceName: context.instanceName,
    runtime: "cloudflare-agent-chat",
  });
  const activeThreadId = context.threadId;
  const threads = await listWorkspaceThreads(
    env,
    { ...identity, agentId: context.agentId },
    activeThreadId,
  );
  const activeThread = threads.find((thread) => thread.threadId === context.threadId) ?? null;

  return json({
    ok: true,
    workspace: workspace
      ? {
          id: workspace.id,
          name: workspace.name,
          status: workspace.status,
          isDefault: workspace.is_default === 1,
        }
      : null,
    activeAgent: toAgentSummary(env, activeAgent, context.agentId),
    activeThread,
    threads,
    connection: {
      agentHost: agentHostFromRequest(request),
      agentName: context.agentName,
      instanceName: context.instanceName,
      token,
      threadId: context.threadId,
      sessionId: context.sessionId,
      workspaceId: context.workspaceId,
      agentId: context.agentId,
    },
    expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
  });
};

export const handleChatSession = async (request: Request, env: Env, identity: AgentIdentity) =>
  buildSessionResponse(request, env, identity);

export const handleCreateChatSessionThread = async (
  request: Request,
  env: Env,
  identity: AgentIdentity,
) => buildSessionResponse(request, env, identity, { fresh: true });

export const handleActivateChatSessionThread = async (
  request: Request,
  env: Env,
  identity: AgentIdentity,
  threadId: string,
) => {
  const thread = await getOwnedChatThread(env, identity.scope, threadId);
  if (!thread) return json({ ok: false, error: "Thread not found" }, { status: 404 });

  const agent = await selectAgent(env, thread.agent_id, identity.scope.workspaceId);
  if (!agent) return json({ ok: false, error: "Thread not found" }, { status: 404 });
  if (agent.status !== "active") {
    return json({ ok: false, error: "Agent is not active" }, { status: 403 });
  }

  await upsertActiveAgentPreference(env, {
    userId: identity.scope.userId,
    workspaceId: identity.scope.workspaceId,
    agentId: agent.id,
    reason: "thread-activated",
  });

  return buildSessionResponse(request, env, { ...identity, agentId: agent.id }, { threadId });
};
