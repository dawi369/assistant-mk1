import { toAgentSummary, toAgentRuntimeMetadata } from "./agent-records";
import { signAgentConnectionClaims } from "./agent-connection-token";
import { upsertActiveAgentPreference } from "./authz";
import { selectAgent, selectWorkspace } from "./authz-store";
import {
  deriveThreadAgentInstanceName,
  resolveThreadAgentInstanceName,
} from "./chat-agent-connection-context";
import {
  createChatSession,
  getLatestChatSession,
  getLatestRunningChatRun,
  getOwnedChatThread,
  touchChatSession,
} from "./chat-boundary-store";
import { appendControlPlaneEvent } from "./control-plane-events";
import { json, parseDataJson, parseJson } from "./http";
import { toThreadLifecycleControlPlaneEvent } from "./session-lifecycle-events";
import type { WorkbenchSessionEvent, WorkbenchSessionEventType } from "./session-event-types";
import {
  createId,
  toJson,
  type AgentIdentity,
  type AgentRow,
  type ChatThreadRow,
  type Env,
} from "./types";

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

type CoordinatorAction =
  | "get"
  | "list"
  | "create"
  | "stageThread"
  | "materializeTurn"
  | "activate"
  | "update"
  | "switchAgent"
  | "stream"
  | "broadcast";
type ThreadListStatus = "active" | "archived";
type ThreadMutationStatus = "active" | "archived" | "deleted";
type AgentSwitchTarget = "current_thread" | "new_thread";
type MaterializedThreadStatus = "active" | "draft";
type SessionTransitionType =
  | "initial"
  | "create"
  | "activate"
  | "agent_handoff"
  | "rename"
  | "archive"
  | "restore"
  | "delete"
  | "token_refresh";
type ThreadStatusTransition = "archive" | "restore" | "delete";

type CoordinatorRequest = {
  action: CoordinatorAction;
  identity: AgentIdentity;
  agentHost?: string;
  threadId?: string;
  refresh?: "threads";
  status?: ThreadListStatus;
  title?: string;
  message?: string;
  update?: {
    title?: string;
    status?: ThreadMutationStatus;
    fallbackTitle?: string;
  };
  agentSwitch?: {
    agentId?: string;
    target?: AgentSwitchTarget;
  };
  event?: Partial<WorkbenchSessionEvent> & {
    type?: WorkbenchSessionEventType;
    data?: Record<string, unknown>;
  };
};

type SessionContext = {
  agentName: "workbench-thread-chat-agent";
  instanceName: string;
  userId: string;
  threadId: string;
  sessionId: string;
  workspaceId: string;
  agentId: string;
  agentUpdatedAt?: string;
  accountId?: string;
  accountSource?: string;
};

type SessionSnapshot = {
  revision: number;
  context: SessionContext | null;
  workspace: {
    id: string;
    name: string;
    status: string;
    isDefault: boolean;
  } | null;
  activeAgent: ReturnType<typeof toAgentSummary>;
  activeThread: ReturnType<typeof toThreadSummary> | null;
  threads: Array<ReturnType<typeof toThreadSummary>>;
  agentHandoff?: AgentHandoffSummary | null;
};

type SessionResponseOptions = {
  partial?: boolean;
  threadsRefreshRecommended?: boolean;
  transition?: { type: SessionTransitionType; startedAt?: string };
  stagedThread?: { threadId: string; sessionId: string; expiresAt: string; status: "draft" };
  materializedTurn?: { threadId: string; status: "accepted" };
  agentHandoff?: AgentHandoffSummary | null;
};

type AgentHandoffSummary = {
  id: string;
  threadId?: string;
  fromAgentId?: string;
  fromAgentName?: string;
  toAgentId: string;
  toAgentName: string;
  target: AgentSwitchTarget;
  createdAt: string;
};

const tokenTtlSeconds = 5 * 60;
const stagedThreadTtlMs = 30 * 60 * 1000;
const sseHeartbeatMs = 15_000;
const sseEncoder = new TextEncoder();
const maxMaterializeTurnMessageLength = 8_000;
const maxAgentHandoffHistory = 20;

const getRequiredSecret = (env: Env) => {
  const secret = env.WORKBENCH_AGENT_CONNECTION_SECRET?.trim();
  if (!secret) throw new Error("WORKBENCH_AGENT_CONNECTION_SECRET is not configured");
  return secret;
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

const formatThreadTimeTitle = (date: Date = new Date()) =>
  new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);

const titleFromInput = (title: string | undefined) => {
  if (title === undefined) return undefined;
  const trimmed = title.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  return trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed;
};

const normalizeMaterializeMessage = (message: unknown) => {
  if (typeof message !== "string") return null;
  const normalized = message.replace(/\r\n/g, "\n").trim();
  if (!normalized || normalized.length > maxMaterializeTurnMessageLength) return null;
  return normalized;
};

const messageCount = (thread: ChatThreadRow) => {
  const upstream = parseDataJson(thread.upstream_json);
  if (typeof upstream.messageCount === "number" && Number.isFinite(upstream.messageCount)) {
    return upstream.messageCount;
  }
  return Array.isArray(upstream.messages) ? upstream.messages.length : 0;
};

const isAgentHandoffSummary = (value: unknown): value is AgentHandoffSummary => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<AgentHandoffSummary>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.toAgentId === "string" &&
    typeof candidate.toAgentName === "string" &&
    (candidate.target === "current_thread" || candidate.target === "new_thread") &&
    typeof candidate.createdAt === "string"
  );
};

const agentHandoffsFromThread = (thread: ChatThreadRow): AgentHandoffSummary[] => {
  const upstream = parseDataJson(thread.upstream_json);
  if (!Array.isArray(upstream.agentHandoffs)) return [];
  return upstream.agentHandoffs.filter(isAgentHandoffSummary).slice(-maxAgentHandoffHistory);
};

const latestAgentHandoff = (thread: ChatThreadRow): AgentHandoffSummary | null => {
  const handoffs = agentHandoffsFromThread(thread);
  return handoffs.at(-1) ?? null;
};

const appendAgentHandoffToUpstream = (
  upstream: Record<string, unknown>,
  handoff: AgentHandoffSummary,
) => ({
  ...upstream,
  agentHandoff: handoff,
  agentHandoffs: [
    ...(Array.isArray(upstream.agentHandoffs)
      ? upstream.agentHandoffs.filter(isAgentHandoffSummary)
      : []),
    handoff,
  ].slice(-maxAgentHandoffHistory),
});

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
  thread: ChatThreadRow | ChatThreadListRow,
  input: { activeThreadId?: string | null; activeAgentId: string; latestRunStatus?: string | null },
) => {
  const maybeListRow = thread as Partial<ChatThreadListRow>;
  const agent = "agent_name" in maybeListRow ? rowAgent(thread as ChatThreadListRow) : null;
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
    agentHandoff: latestAgentHandoff(thread),
    latestRunStatus:
      input.latestRunStatus ??
      ("latest_run_status" in maybeListRow
        ? (maybeListRow.latest_run_status ?? undefined)
        : undefined),
    messageCount: messageCount(thread),
  };
};

const toActiveThreadSummary = (
  env: Env,
  thread: ChatThreadRow,
  agent: AgentRow,
  activeThreadId: string,
) => ({
  ...toThreadSummary(env, thread, {
    activeThreadId,
    activeAgentId: agent.id,
  }),
  agent: toAgentSummary(env, agent, agent.id),
});

const mergeActiveThread = (
  threads: SessionSnapshot["threads"],
  activeThread: ReturnType<typeof toThreadSummary>,
) => {
  const seen = new Set<string>();
  const merged = [
    activeThread,
    ...threads.map((thread) => ({
      ...thread,
      isActive: thread.threadId === activeThread.threadId,
    })),
  ].filter((thread) => {
    if (seen.has(thread.threadId)) return false;
    seen.add(thread.threadId);
    return true;
  });
  return merged.slice(0, 30);
};

const workspaceSummary = async (
  env: Env,
  workspaceId: string,
): Promise<SessionSnapshot["workspace"]> => {
  const workspace = await selectWorkspace(env, workspaceId);
  return workspace
    ? {
        id: workspace.id,
        name: workspace.name,
        status: workspace.status,
        isDefault: workspace.is_default === 1,
      }
    : null;
};

const listWorkspaceThreads = async (
  env: Env,
  identity: AgentIdentity,
  activeThreadId?: string,
  status: ThreadListStatus = "active",
) => {
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
     WHERE t.user_id = ? AND t.workspace_id = ? AND t.status = ?
     ORDER BY t.created_at DESC, t.thread_id DESC
     LIMIT 30`,
  )
    .bind(identity.scope.userId, identity.scope.workspaceId, status)
    .all<ChatThreadListRow>();

  return threads.results.map((thread) =>
    toThreadSummary(env, thread, {
      activeThreadId,
      activeAgentId: identity.agentId,
    }),
  );
};

const createThreadContext = async (
  env: Env,
  identity: AgentIdentity,
  sessionId: string,
  title?: string,
  options: { status?: MaterializedThreadStatus; draftExpiresAt?: string } = {},
) => {
  const activeAgent = await selectAgent(env, identity.agentId, identity.scope.workspaceId);
  if (!activeAgent || activeAgent.status !== "active") {
    throw new Error("Agent is not active");
  }

  const timestamp = new Date().toISOString();
  const threadTitle = titleFromInput(title) ?? formatThreadTimeTitle(new Date(timestamp));
  const status = options.status ?? "active";
  const threadId = createId("cf-thread");
  const instanceName = await deriveThreadAgentInstanceName({
    userId: identity.scope.userId,
    workspaceId: identity.scope.workspaceId,
    threadId,
  });
  const upstream = {
    source: "cloudflare-agent-chat",
    runtime: "cloudflare-agent-chat",
    title: threadTitle,
    threadId,
    instanceName,
    agent: toAgentRuntimeMetadata(env, activeAgent, identity.agentId),
    ...(status === "draft"
      ? {
          draft: true,
          stagedAt: timestamp,
          stageExpiresAt: options.draftExpiresAt,
        }
      : {}),
  };
  await env.DB.batch([
    env.DB.prepare(
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
    ).bind(
      threadId,
      sessionId,
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.agentId,
      status,
      toJson(upstream),
      timestamp,
      timestamp,
      timestamp,
    ),
    env.DB.prepare(
      `UPDATE chat_sessions
       SET active_thread_id = ?,
           last_seen_at = ?,
           updated_at = ?
       WHERE user_id = ? AND workspace_id = ? AND session_id = ?`,
    ).bind(
      threadId,
      timestamp,
      timestamp,
      identity.scope.userId,
      identity.scope.workspaceId,
      sessionId,
    ),
  ]);
  const thread: ChatThreadRow = {
    thread_id: threadId,
    session_id: sessionId,
    user_id: identity.scope.userId,
    workspace_id: identity.scope.workspaceId,
    agent_id: identity.agentId,
    status,
    upstream_json: toJson(upstream),
    created_at: timestamp,
    updated_at: timestamp,
    last_seen_at: timestamp,
  };

  return { activeAgent, thread, instanceName };
};

const sessionContext = async (
  identity: AgentIdentity,
  input: { thread: ChatThreadRow; agent: AgentRow; accountId?: string; accountSource?: string },
): Promise<SessionContext> => ({
  agentName: "workbench-thread-chat-agent",
  instanceName: await resolveThreadAgentInstanceName(input.thread),
  userId: identity.scope.userId,
  threadId: input.thread.thread_id,
  sessionId: input.thread.session_id,
  workspaceId: identity.scope.workspaceId,
  agentId: input.agent.id,
  agentUpdatedAt: input.agent.updated_at,
  accountId: input.accountId,
  accountSource: input.accountSource,
});

const buildSnapshot = async (
  env: Env,
  identity: AgentIdentity,
  input: { activeThread?: ChatThreadRow; activeAgent?: AgentRow; revision: number },
): Promise<SessionSnapshot> => {
  const workspace = await selectWorkspace(env, identity.scope.workspaceId);
  const latestSession = input.activeThread ? null : await getLatestChatSession(env, identity.scope);
  let thread =
    input.activeThread ??
    (latestSession?.active_thread_id
      ? await getOwnedChatThread(env, identity.scope, latestSession.active_thread_id)
      : null);
  if (thread?.status !== "active" && thread?.status !== "draft") thread = null;
  let agent =
    input.activeAgent ?? (await selectAgent(env, identity.agentId, identity.scope.workspaceId));

  if (!agent || agent.status !== "active") {
    throw new Error("Agent is not active");
  }

  if (thread && thread.agent_id !== agent.id) {
    const threadAgent = await selectAgent(env, thread.agent_id, identity.scope.workspaceId);
    if (!threadAgent || threadAgent.status !== "active") {
      throw new Error("Agent is not active");
    }
    agent = threadAgent;
  }

  const activeIdentity = { ...identity, agentId: agent.id };
  const threads = await listWorkspaceThreads(env, activeIdentity, thread?.thread_id);
  const activeThread = thread
    ? (threads.find((candidate) => candidate.threadId === thread.thread_id) ??
      toThreadSummary(env, thread, {
        activeThreadId: thread.thread_id,
        activeAgentId: agent.id,
      }))
    : null;
  const context = thread
    ? await sessionContext(activeIdentity, {
        thread,
        agent,
        accountId: identity.accountId,
        accountSource: identity.accountSource,
      })
    : null;

  return {
    revision: input.revision,
    context,
    workspace: workspace
      ? {
          id: workspace.id,
          name: workspace.name,
          status: workspace.status,
          isDefault: workspace.is_default === 1,
        }
      : null,
    activeAgent: toAgentSummary(env, agent, agent.id),
    activeThread,
    threads,
    agentHandoff: activeThread?.agentHandoff ?? null,
  };
};

const responseFromSnapshot = async (
  env: Env,
  agentHost: string,
  snapshot: SessionSnapshot,
  options: SessionResponseOptions = {},
) => {
  const expiresAtSeconds = Math.floor(Date.now() / 1000) + tokenTtlSeconds;
  const connection = snapshot.context
    ? {
        token: await signAgentConnectionClaims(getRequiredSecret(env), {
          v: 1,
          exp: expiresAtSeconds,
          nonce: crypto.randomUUID(),
          userId: snapshot.context.userId,
          accountId: snapshot.context.accountId,
          accountSource: snapshot.context.accountSource,
          workspaceId: snapshot.context.workspaceId,
          agentId: snapshot.context.agentId,
          agentUpdatedAt: snapshot.context.agentUpdatedAt,
          threadId: snapshot.context.threadId,
          sessionId: snapshot.context.sessionId,
          instanceName: snapshot.context.instanceName,
          runtime: "cloudflare-agent-chat",
        }),
        expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
      }
    : null;
  return {
    ok: true,
    revision: snapshot.revision,
    workspace: snapshot.workspace,
    activeAgent: snapshot.activeAgent,
    activeThread: snapshot.activeThread,
    threads: snapshot.threads,
    agentHandoff: options.agentHandoff ?? snapshot.agentHandoff ?? null,
    connection: snapshot.context
      ? {
          agentHost,
          agentName: snapshot.context.agentName,
          instanceName: snapshot.context.instanceName,
          token: connection!.token,
          expiresAt: connection!.expiresAt,
          threadId: snapshot.context.threadId,
          sessionId: snapshot.context.sessionId,
          workspaceId: snapshot.context.workspaceId,
          agentId: snapshot.context.agentId,
        }
      : undefined,
    expiresAt: connection?.expiresAt,
    partial: options.partial,
    threadsRefreshRecommended: options.threadsRefreshRecommended,
    transition: options.transition,
    stagedThread: options.stagedThread,
    materializedTurn: options.materializedTurn,
  };
};

const ensureCoordinatorRequest = (value: unknown): CoordinatorRequest | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<CoordinatorRequest>;
  if (
    candidate.action !== "get" &&
    candidate.action !== "list" &&
    candidate.action !== "create" &&
    candidate.action !== "stageThread" &&
    candidate.action !== "materializeTurn" &&
    candidate.action !== "activate" &&
    candidate.action !== "update" &&
    candidate.action !== "switchAgent" &&
    candidate.action !== "stream" &&
    candidate.action !== "broadcast"
  ) {
    return null;
  }
  if (!candidate.identity?.scope?.userId || !candidate.identity.scope.workspaceId) return null;
  if (candidate.action !== "stream" && candidate.action !== "broadcast" && !candidate.agentHost) {
    return null;
  }
  return candidate as CoordinatorRequest;
};

const encodeSse = (event: WorkbenchSessionEvent) =>
  `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

const encodeHeartbeat = () => `: heartbeat ${new Date().toISOString()}\n\n`;

const safeSnapshotData = (snapshot: SessionSnapshot) => ({
  revision: snapshot.revision,
  workspace: snapshot.workspace,
  activeAgent: snapshot.activeAgent,
  activeThread: snapshot.activeThread,
  threads: snapshot.threads,
  agentHandoff: snapshot.agentHandoff ?? null,
});

const safeThreadData = (snapshot: SessionSnapshot, thread: ReturnType<typeof toThreadSummary>) => ({
  ...safeSnapshotData(snapshot),
  thread,
});

const transitionForStatus = (status: ThreadMutationStatus): ThreadStatusTransition => {
  if (status === "active") return "restore";
  if (status === "archived") return "archive";
  return "delete";
};

const findFallbackActiveThread = async (
  env: Env,
  identity: AgentIdentity,
  excludeThreadId?: string,
) =>
  env.DB.prepare(
    `SELECT thread_id, session_id, user_id, workspace_id, agent_id, status, upstream_json,
            created_at, updated_at, last_seen_at
     FROM chat_threads
     WHERE user_id = ? AND workspace_id = ? AND status = 'active' AND thread_id != ?
     ORDER BY created_at DESC, thread_id DESC
     LIMIT 1`,
  )
    .bind(identity.scope.userId, identity.scope.workspaceId, excludeThreadId ?? "")
    .first<ChatThreadRow>();

const titleFromUpdate = titleFromInput;

const appendThreadLifecycleEvent = (
  env: Env,
  identity: AgentIdentity,
  input: Parameters<typeof toThreadLifecycleControlPlaneEvent>[0],
) => appendControlPlaneEvent(env, identity, toThreadLifecycleControlPlaneEvent(input));

const clearActiveThread = async (env: Env, identity: AgentIdentity, sessionId: string) => {
  const timestamp = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE chat_sessions
     SET active_thread_id = NULL,
         last_seen_at = ?,
         updated_at = ?
     WHERE user_id = ? AND workspace_id = ? AND session_id = ?`,
  )
    .bind(timestamp, timestamp, identity.scope.userId, identity.scope.workspaceId, sessionId)
    .run();
};

const updateChatSessionAgent = async (
  env: Env,
  identity: AgentIdentity,
  input: { sessionId: string; agentId: string; activeThreadId?: string | null },
) => {
  const timestamp = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE chat_sessions
     SET agent_id = ?,
         active_thread_id = ?,
         last_seen_at = ?,
         updated_at = ?
     WHERE user_id = ? AND workspace_id = ? AND session_id = ?`,
  )
    .bind(
      input.agentId,
      input.activeThreadId ?? null,
      timestamp,
      timestamp,
      identity.scope.userId,
      identity.scope.workspaceId,
      input.sessionId,
    )
    .run();
};

const draftExpiryFromThread = (thread: ChatThreadRow) => {
  const upstream = parseDataJson(thread.upstream_json);
  const rawExpiresAt = typeof upstream.stageExpiresAt === "string" ? upstream.stageExpiresAt : "";
  const expiresAtMs = rawExpiresAt ? Date.parse(rawExpiresAt) : NaN;
  if (Number.isFinite(expiresAtMs)) return new Date(expiresAtMs).toISOString();

  const createdAtMs = Date.parse(thread.created_at);
  const fallbackMs = Number.isFinite(createdAtMs) ? createdAtMs : Date.now();
  return new Date(fallbackMs + stagedThreadTtlMs).toISOString();
};

const isExpiredDraftThread = (thread: ChatThreadRow) =>
  thread.status === "draft" && Date.parse(draftExpiryFromThread(thread)) <= Date.now();

const markThreadDeleted = async (env: Env, identity: AgentIdentity, thread: ChatThreadRow) => {
  const timestamp = new Date().toISOString();
  const upstream = {
    ...parseDataJson(thread.upstream_json),
    draft: false,
    abandonedAt: timestamp,
  };
  await env.DB.prepare(
    `UPDATE chat_threads
     SET status = 'deleted',
         upstream_json = ?,
         updated_at = ?,
         last_seen_at = ?
     WHERE user_id = ? AND workspace_id = ? AND thread_id = ? AND status = 'draft'`,
  )
    .bind(
      toJson(upstream),
      timestamp,
      timestamp,
      identity.scope.userId,
      identity.scope.workspaceId,
      thread.thread_id,
    )
    .run();
};

const reusableDraftThread = async (
  env: Env,
  identity: AgentIdentity,
  sessionId: string,
  activeThreadId?: string | null,
) => {
  if (!activeThreadId) return null;
  const thread = await getOwnedChatThread(env, identity.scope, activeThreadId);
  if (!thread || thread.session_id !== sessionId || thread.status !== "draft") return null;
  if (!isExpiredDraftThread(thread)) return thread;
  await markThreadDeleted(env, identity, thread);
  return null;
};

const submitProgrammaticTurn = async (
  env: Env,
  input: { context: SessionContext; token: string; message: string },
) => {
  if (!env.WorkbenchThreadChatAgent) {
    return { ok: false, error: "WorkbenchThreadChatAgent binding is not configured", status: 500 };
  }

  const stub = env.WorkbenchThreadChatAgent.get(
    env.WorkbenchThreadChatAgent.idFromName(input.context.instanceName),
  );
  const response = await stub.fetch("https://thread-agent.internal/internal/programmatic-submit", {
    method: "POST",
    body: JSON.stringify({
      token: input.token,
      message: input.message,
      threadId: input.context.threadId,
      sessionId: input.context.sessionId,
    }),
  });
  if (response.ok) return { ok: true, status: response.status };
  const body = (await response.json().catch(() => ({}))) as { error?: unknown };
  return {
    ok: false,
    error: typeof body.error === "string" ? body.error : "Programmatic turn submit failed",
    status: response.status,
  };
};

export class WorkbenchSessionAgent {
  private snapshot: SessionSnapshot | null = null;
  private revision = 0;
  private clients = new Map<string, ReadableStreamDefaultController<Uint8Array>>();

  constructor(
    _state: unknown,
    private readonly env: Env,
  ) {}

  private nextRevision() {
    this.revision += 1;
    return this.revision;
  }

  private createEvent(
    type: WorkbenchSessionEventType,
    data: Record<string, unknown>,
    input?: { id?: string; createdAt?: string; revision?: number },
  ): WorkbenchSessionEvent {
    return {
      id: input?.id ?? createId("cf-session-event"),
      type,
      revision: input?.revision ?? this.snapshot?.revision,
      createdAt: input?.createdAt ?? new Date().toISOString(),
      data,
    };
  }

  private sendEvent(
    controller: ReadableStreamDefaultController<Uint8Array>,
    event: WorkbenchSessionEvent,
  ) {
    controller.enqueue(sseEncoder.encode(encodeSse(event)));
  }

  private broadcastEvent(event: WorkbenchSessionEvent) {
    for (const [clientId, controller] of this.clients) {
      try {
        this.sendEvent(controller, event);
      } catch {
        this.clients.delete(clientId);
      }
    }
  }

  private async ensureSnapshot(input: CoordinatorRequest) {
    if (!this.snapshot) {
      this.snapshot = await buildSnapshot(this.env, input.identity, {
        revision: this.nextRevision(),
      });
    }
    return this.snapshot;
  }

  private async getSession(input: CoordinatorRequest) {
    if (!this.snapshot || input.refresh === "threads") {
      this.snapshot = await buildSnapshot(this.env, input.identity, {
        revision: this.nextRevision(),
      });
      if (input.refresh === "threads") {
        this.broadcastEvent(
          this.createEvent("session.threads.refreshed", safeSnapshotData(this.snapshot)),
        );
      }
    }
    return responseFromSnapshot(this.env, input.agentHost!, this.snapshot, {
      partial: false,
      transition: { type: input.refresh === "threads" ? "initial" : "token_refresh" },
    });
  }

  private async listThreads(input: CoordinatorRequest) {
    const latestSession = await getLatestChatSession(this.env, input.identity.scope);
    return {
      ok: true,
      threads: await listWorkspaceThreads(
        this.env,
        input.identity,
        latestSession?.active_thread_id ?? undefined,
        input.status === "archived" ? "archived" : "active",
      ),
    };
  }

  private async createThread(input: CoordinatorRequest) {
    const startedAt = new Date().toISOString();
    const sessionId =
      this.snapshot?.context?.sessionId ??
      (await getLatestChatSession(this.env, input.identity.scope))?.session_id ??
      (await createChatSession(this.env, input.identity, { source: "cloudflare-agent-chat" }));
    const created = await createThreadContext(this.env, input.identity, sessionId, input.title);
    const activeIdentity = { ...input.identity, agentId: created.activeAgent.id };
    const activeThread = toActiveThreadSummary(
      this.env,
      created.thread,
      created.activeAgent,
      created.thread.thread_id,
    );
    const context = await sessionContext(activeIdentity, {
      thread: created.thread,
      agent: created.activeAgent,
      accountId: input.identity.accountId,
      accountSource: input.identity.accountSource,
    });
    this.snapshot = {
      revision: this.nextRevision(),
      context,
      workspace:
        this.snapshot?.workspace ??
        (await workspaceSummary(this.env, input.identity.scope.workspaceId)),
      activeAgent: toAgentSummary(this.env, created.activeAgent, created.activeAgent.id),
      activeThread,
      threads: mergeActiveThread(this.snapshot?.threads ?? [], activeThread),
    };
    await appendThreadLifecycleEvent(this.env, activeIdentity, {
      transition: "create",
      threadId: activeThread.threadId,
      activeThreadId: activeThread.threadId,
      nextStatus: activeThread.status,
    });
    this.broadcastEvent(
      this.createEvent("session.thread.created", {
        ...safeSnapshotData(this.snapshot),
        transition: { type: "create", startedAt },
      }),
    );
    this.broadcastEvent(
      this.createEvent("admin.summary.invalidated", {
        reason: "thread-created",
        threadId: activeThread.threadId,
      }),
    );
    return responseFromSnapshot(this.env, input.agentHost!, this.snapshot, {
      partial: true,
      threadsRefreshRecommended: true,
      transition: { type: "create", startedAt },
    });
  }

  private async stageThread(input: CoordinatorRequest) {
    const latestSession = await getLatestChatSession(this.env, input.identity.scope);
    const sessionId =
      this.snapshot?.context?.sessionId ??
      latestSession?.session_id ??
      (await createChatSession(this.env, input.identity, { source: "cloudflare-agent-chat" }));
    const reusable =
      (this.snapshot?.context?.threadId
        ? await reusableDraftThread(
            this.env,
            input.identity,
            sessionId,
            this.snapshot.context.threadId,
          )
        : null) ??
      (await reusableDraftThread(
        this.env,
        input.identity,
        sessionId,
        latestSession?.active_thread_id,
      ));
    const draftExpiresAt = reusable
      ? draftExpiryFromThread(reusable)
      : new Date(Date.now() + stagedThreadTtlMs).toISOString();
    const created = reusable
      ? {
          activeAgent: await selectAgent(
            this.env,
            reusable.agent_id,
            input.identity.scope.workspaceId,
          ),
          thread: reusable,
        }
      : await createThreadContext(this.env, input.identity, sessionId, "New chat", {
          status: "draft",
          draftExpiresAt,
        });

    if (!created.activeAgent || created.activeAgent.status !== "active") {
      throw new Error("Agent is not active");
    }

    const activeIdentity = { ...input.identity, agentId: created.activeAgent.id };
    const activeThread = toActiveThreadSummary(
      this.env,
      created.thread,
      created.activeAgent,
      created.thread.thread_id,
    );
    const context = await sessionContext(activeIdentity, {
      thread: created.thread,
      agent: created.activeAgent,
      accountId: input.identity.accountId,
      accountSource: input.identity.accountSource,
    });
    this.snapshot = {
      revision: this.nextRevision(),
      context,
      workspace:
        this.snapshot?.workspace ??
        (await workspaceSummary(this.env, input.identity.scope.workspaceId)),
      activeAgent: toAgentSummary(this.env, created.activeAgent, created.activeAgent.id),
      activeThread,
      threads: (this.snapshot?.threads ?? [])
        .filter((thread) => thread.threadId !== activeThread.threadId)
        .map((thread) => ({ ...thread, isActive: false })),
    };

    return responseFromSnapshot(this.env, input.agentHost!, this.snapshot, {
      partial: true,
      stagedThread: {
        threadId: activeThread.threadId,
        sessionId: activeThread.sessionId,
        expiresAt: draftExpiresAt,
        status: "draft",
      },
    });
  }

  private async materializeTurn(input: CoordinatorRequest) {
    const startedAt = new Date().toISOString();
    const message = normalizeMaterializeMessage(input.message);
    if (!message) {
      return {
        ok: false,
        error: `message must be non-empty text under ${maxMaterializeTurnMessageLength} characters`,
        status: 400,
      };
    }

    const sessionId =
      this.snapshot?.context?.sessionId ??
      (await getLatestChatSession(this.env, input.identity.scope))?.session_id ??
      (await createChatSession(this.env, input.identity, { source: "cloudflare-agent-chat" }));
    const created = await createThreadContext(this.env, input.identity, sessionId, message);
    const activeIdentity = { ...input.identity, agentId: created.activeAgent.id };
    const activeThread = toActiveThreadSummary(
      this.env,
      created.thread,
      created.activeAgent,
      created.thread.thread_id,
    );
    const context = await sessionContext(activeIdentity, {
      thread: created.thread,
      agent: created.activeAgent,
      accountId: input.identity.accountId,
      accountSource: input.identity.accountSource,
    });
    this.snapshot = {
      revision: this.nextRevision(),
      context,
      workspace:
        this.snapshot?.workspace ??
        (await workspaceSummary(this.env, input.identity.scope.workspaceId)),
      activeAgent: toAgentSummary(this.env, created.activeAgent, created.activeAgent.id),
      activeThread,
      threads: mergeActiveThread(this.snapshot?.threads ?? [], activeThread),
    };

    const response = await responseFromSnapshot(this.env, input.agentHost!, this.snapshot, {
      partial: true,
      threadsRefreshRecommended: true,
      transition: { type: "create", startedAt },
      materializedTurn: { threadId: activeThread.threadId, status: "accepted" },
    });
    const token = response.connection?.token;
    if (!token) {
      return { ok: false, error: "Materialized Agent connection token was missing", status: 500 };
    }
    const submitted = await submitProgrammaticTurn(this.env, { context, token, message });
    if (!submitted.ok) {
      return {
        ok: false,
        error: submitted.error,
        status: submitted.status,
      };
    }

    await appendThreadLifecycleEvent(this.env, activeIdentity, {
      transition: "create",
      threadId: activeThread.threadId,
      activeThreadId: activeThread.threadId,
      nextStatus: activeThread.status,
    });
    this.broadcastEvent(
      this.createEvent("session.thread.created", {
        ...safeSnapshotData(this.snapshot),
        transition: { type: "create", startedAt },
      }),
    );
    this.broadcastEvent(
      this.createEvent("admin.summary.invalidated", {
        reason: "thread-created",
        threadId: activeThread.threadId,
      }),
    );

    return response;
  }

  private async updateThread(input: CoordinatorRequest) {
    const startedAt = new Date().toISOString();
    const threadId = input.threadId?.trim();
    if (!threadId) return { ok: false, error: "threadId is required", status: 400 };
    if (input.update?.title === undefined && !input.update?.status) {
      return { ok: false, error: "title or status is required", status: 400 };
    }

    const thread = await getOwnedChatThread(this.env, input.identity.scope, threadId);
    if (!thread || thread.status === "deleted") {
      return { ok: false, error: "Thread not found", status: 404 };
    }

    const nextTitle = titleFromUpdate(input.update.title);
    if (nextTitle === null) return { ok: false, error: "title cannot be empty", status: 400 };

    const nextStatus = input.update.status;
    if (nextStatus === "archived" || nextStatus === "deleted") {
      const runningRun = await getLatestRunningChatRun(this.env, input.identity.scope, threadId);
      if (runningRun) {
        await appendThreadLifecycleEvent(this.env, input.identity, {
          transition: "blocked",
          threadId,
          previousStatus: thread.status,
          nextStatus,
          blockedAction: transitionForStatus(nextStatus),
          reasonCode: "running_chat_response",
        });
        return {
          ok: false,
          error: "Thread has a running chat response",
          status: 409,
        };
      }
    }

    const timestamp = new Date().toISOString();
    const upstream = parseDataJson(thread.upstream_json);
    if (nextTitle !== undefined) upstream.title = nextTitle;
    const status = nextStatus ?? thread.status;
    await this.env.DB.prepare(
      `UPDATE chat_threads
       SET status = ?,
           upstream_json = ?,
           updated_at = ?,
           last_seen_at = ?
       WHERE user_id = ? AND workspace_id = ? AND thread_id = ?`,
    )
      .bind(
        status,
        toJson(upstream),
        timestamp,
        timestamp,
        input.identity.scope.userId,
        input.identity.scope.workspaceId,
        threadId,
      )
      .run();

    const latestSession = await getLatestChatSession(this.env, input.identity.scope);
    const deactivatedActiveThread =
      latestSession?.active_thread_id === threadId &&
      (nextStatus === "archived" || nextStatus === "deleted");
    let snapshotIdentity = input.identity;
    let activeThread: ChatThreadRow | undefined;
    let activeAgent: AgentRow | undefined;

    if (deactivatedActiveThread) {
      const fallback = await findFallbackActiveThread(this.env, input.identity, threadId);
      if (fallback) {
        const fallbackAgent = await selectAgent(
          this.env,
          fallback.agent_id,
          input.identity.scope.workspaceId,
        );
        if (!fallbackAgent || fallbackAgent.status !== "active") {
          throw new Error("Agent is not active");
        }
        await upsertActiveAgentPreference(this.env, {
          userId: input.identity.scope.userId,
          workspaceId: input.identity.scope.workspaceId,
          agentId: fallbackAgent.id,
          reason: "thread-lifecycle-fallback",
        });
        await touchChatSession(
          this.env,
          input.identity.scope,
          fallback.session_id,
          fallback.thread_id,
        );
        snapshotIdentity = { ...input.identity, agentId: fallbackAgent.id };
        activeThread = fallback;
        activeAgent = fallbackAgent;
      } else {
        if (latestSession?.session_id) {
          await clearActiveThread(this.env, input.identity, latestSession.session_id);
        }
      }
    }

    this.snapshot = await buildSnapshot(this.env, snapshotIdentity, {
      revision: this.nextRevision(),
      activeThread,
      activeAgent,
    });
    const updatedThread =
      (await getOwnedChatThread(this.env, input.identity.scope, threadId)) ?? thread;
    const updatedAgent =
      (await selectAgent(this.env, updatedThread.agent_id, input.identity.scope.workspaceId)) ??
      activeAgent;
    const activeThreadId = this.snapshot.context?.threadId ?? null;
    const activeAgentId = this.snapshot.context?.agentId ?? this.snapshot.activeAgent.id;
    const summarizedThread = updatedAgent
      ? toActiveThreadSummary(this.env, updatedThread, updatedAgent, activeThreadId ?? "")
      : toThreadSummary(this.env, updatedThread, {
          activeThreadId,
          activeAgentId,
        });
    const transition = nextStatus ? transitionForStatus(nextStatus) : "rename";
    await appendThreadLifecycleEvent(this.env, snapshotIdentity, {
      transition,
      threadId,
      activeThreadId: activeThreadId ?? undefined,
      replacementThreadId: deactivatedActiveThread ? (activeThreadId ?? undefined) : undefined,
      previousStatus: thread.status,
      nextStatus: updatedThread.status,
    });

    this.broadcastEvent(
      this.createEvent("session.thread.updated", {
        ...safeThreadData(this.snapshot, summarizedThread),
        transition: { type: transition, startedAt },
      }),
    );
    this.broadcastEvent(
      this.createEvent("admin.summary.invalidated", {
        reason: `thread-${transition}`,
        threadId,
      }),
    );
    return responseFromSnapshot(this.env, input.agentHost!, this.snapshot, {
      partial: true,
      threadsRefreshRecommended: true,
      transition: { type: transition, startedAt },
    });
  }

  private async activateThread(input: CoordinatorRequest) {
    const startedAt = new Date().toISOString();
    const threadId = input.threadId?.trim();
    if (!threadId) return { ok: false, error: "threadId is required" };

    const thread = await getOwnedChatThread(this.env, input.identity.scope, threadId);
    if (!thread || thread.status !== "active") {
      return { ok: false, error: "Thread not found", status: 404 };
    }

    const agent = await selectAgent(this.env, thread.agent_id, input.identity.scope.workspaceId);
    if (!agent) return { ok: false, error: "Thread not found", status: 404 };
    if (agent.status !== "active") return { ok: false, error: "Agent is not active", status: 403 };

    await upsertActiveAgentPreference(this.env, {
      userId: input.identity.scope.userId,
      workspaceId: input.identity.scope.workspaceId,
      agentId: agent.id,
      reason: "thread-activated",
    });
    await touchChatSession(this.env, input.identity.scope, thread.session_id, thread.thread_id);

    const activeIdentity = { ...input.identity, agentId: agent.id };
    const activeThread = toActiveThreadSummary(this.env, thread, agent, thread.thread_id);
    const context = await sessionContext(activeIdentity, {
      thread,
      agent,
      accountId: input.identity.accountId,
      accountSource: input.identity.accountSource,
    });
    this.snapshot = {
      revision: this.nextRevision(),
      context,
      workspace:
        this.snapshot?.workspace ??
        (await workspaceSummary(this.env, input.identity.scope.workspaceId)),
      activeAgent: toAgentSummary(this.env, agent, agent.id),
      activeThread,
      threads: mergeActiveThread(this.snapshot?.threads ?? [], activeThread),
    };
    await appendThreadLifecycleEvent(this.env, activeIdentity, {
      transition: "activate",
      threadId: activeThread.threadId,
      activeThreadId: activeThread.threadId,
      nextStatus: activeThread.status,
    });
    this.broadcastEvent(
      this.createEvent("session.thread.activated", {
        ...safeSnapshotData(this.snapshot),
        transition: { type: "activate", startedAt },
      }),
    );
    this.broadcastEvent(
      this.createEvent("admin.summary.invalidated", {
        reason: "thread-activated",
        threadId: activeThread.threadId,
      }),
    );
    return responseFromSnapshot(this.env, input.agentHost!, this.snapshot, {
      partial: true,
      threadsRefreshRecommended: true,
      transition: { type: "activate", startedAt },
    });
  }

  private async switchAgent(input: CoordinatorRequest) {
    const startedAt = new Date().toISOString();
    const agentId = input.agentSwitch?.agentId?.trim();
    const target = input.agentSwitch?.target ?? "current_thread";
    if (!agentId) return { ok: false, error: "agentId is required", status: 400 };

    const targetAgent = await selectAgent(this.env, agentId, input.identity.scope.workspaceId);
    if (!targetAgent) return { ok: false, error: "Agent not found", status: 404 };
    if (targetAgent.status !== "active") {
      return { ok: false, error: "Agent is not active", status: 403 };
    }

    const activeIdentity = { ...input.identity, agentId: targetAgent.id };
    const latestSession = await getLatestChatSession(this.env, input.identity.scope);
    const activeThreadId =
      target === "current_thread"
        ? (input.threadId?.trim() ??
          this.snapshot?.activeThread?.threadId ??
          latestSession?.active_thread_id ??
          "")
        : "";

    if (target === "new_thread") {
      await upsertActiveAgentPreference(this.env, {
        userId: input.identity.scope.userId,
        workspaceId: input.identity.scope.workspaceId,
        agentId: targetAgent.id,
        reason: "agent-selected-new-thread",
      });
      if (latestSession?.session_id) {
        await updateChatSessionAgent(this.env, input.identity, {
          sessionId: latestSession.session_id,
          agentId: targetAgent.id,
          activeThreadId: null,
        });
      }
      this.snapshot = await buildSnapshot(this.env, activeIdentity, {
        revision: this.nextRevision(),
        activeAgent: targetAgent,
      });
      this.broadcastEvent(
        this.createEvent("session.agent.handoff", {
          ...safeSnapshotData(this.snapshot),
          transition: { type: "agent_handoff", startedAt },
          agentHandoff: {
            id: createId("cf-agent-handoff"),
            toAgentId: targetAgent.id,
            toAgentName: targetAgent.name,
            target,
            createdAt: startedAt,
          } satisfies AgentHandoffSummary,
        }),
      );
      this.broadcastEvent(
        this.createEvent("admin.summary.invalidated", {
          reason: "agent-selected-new-thread",
          agentId: targetAgent.id,
        }),
      );
      return responseFromSnapshot(this.env, input.agentHost!, this.snapshot, {
        partial: true,
        threadsRefreshRecommended: true,
        transition: { type: "agent_handoff", startedAt },
        agentHandoff: null,
      });
    }

    if (!activeThreadId) return { ok: false, error: "No active thread to continue", status: 400 };
    const thread = await getOwnedChatThread(this.env, input.identity.scope, activeThreadId);
    if (!thread || thread.status !== "active") {
      return { ok: false, error: "Thread not found", status: 404 };
    }
    const runningRun = await getLatestRunningChatRun(
      this.env,
      input.identity.scope,
      thread.thread_id,
    );
    if (runningRun) {
      return { ok: false, error: "Thread has a running chat response", status: 409 };
    }
    await upsertActiveAgentPreference(this.env, {
      userId: input.identity.scope.userId,
      workspaceId: input.identity.scope.workspaceId,
      agentId: targetAgent.id,
      reason: "agent-handoff",
    });

    const fromAgent = await selectAgent(
      this.env,
      thread.agent_id,
      input.identity.scope.workspaceId,
    );
    const handoff: AgentHandoffSummary = {
      id: createId("cf-agent-handoff"),
      threadId: thread.thread_id,
      fromAgentId: fromAgent?.id,
      fromAgentName: fromAgent?.name,
      toAgentId: targetAgent.id,
      toAgentName: targetAgent.name,
      target,
      createdAt: startedAt,
    };
    const upstream = appendAgentHandoffToUpstream(
      {
        ...parseDataJson(thread.upstream_json),
        instanceName: await resolveThreadAgentInstanceName(thread),
        agent: toAgentRuntimeMetadata(this.env, targetAgent, targetAgent.id),
      },
      handoff,
    );
    const timestamp = new Date().toISOString();
    await this.env.DB.batch([
      this.env.DB.prepare(
        `UPDATE chat_threads
         SET agent_id = ?,
             upstream_json = ?,
             updated_at = ?,
             last_seen_at = ?
         WHERE user_id = ? AND workspace_id = ? AND thread_id = ?`,
      ).bind(
        targetAgent.id,
        toJson(upstream),
        timestamp,
        timestamp,
        input.identity.scope.userId,
        input.identity.scope.workspaceId,
        thread.thread_id,
      ),
      this.env.DB.prepare(
        `UPDATE chat_sessions
         SET agent_id = ?,
             active_thread_id = ?,
             last_seen_at = ?,
             updated_at = ?
         WHERE user_id = ? AND workspace_id = ? AND session_id = ?`,
      ).bind(
        targetAgent.id,
        thread.thread_id,
        timestamp,
        timestamp,
        input.identity.scope.userId,
        input.identity.scope.workspaceId,
        thread.session_id,
      ),
    ]);

    const updatedThread: ChatThreadRow = {
      ...thread,
      agent_id: targetAgent.id,
      upstream_json: toJson(upstream),
      updated_at: timestamp,
      last_seen_at: timestamp,
    };
    this.snapshot = await buildSnapshot(this.env, activeIdentity, {
      revision: this.nextRevision(),
      activeThread: updatedThread,
      activeAgent: targetAgent,
    });
    this.snapshot.agentHandoff = handoff;

    await appendControlPlaneEvent(this.env, activeIdentity, {
      type: "session.agent.handoff",
      summary: `Switched agent from ${fromAgent?.name ?? "Unknown agent"} to ${targetAgent.name}.`,
      targetType: "chat_thread",
      targetId: thread.thread_id,
      data: { agentHandoff: handoff },
    });
    this.broadcastEvent(
      this.createEvent("session.agent.handoff", {
        ...safeSnapshotData(this.snapshot),
        transition: { type: "agent_handoff", startedAt },
        agentHandoff: handoff,
      }),
    );
    this.broadcastEvent(
      this.createEvent("admin.summary.invalidated", {
        reason: "agent-handoff",
        threadId: thread.thread_id,
        agentId: targetAgent.id,
      }),
    );
    return responseFromSnapshot(this.env, input.agentHost!, this.snapshot, {
      partial: true,
      threadsRefreshRecommended: true,
      transition: { type: "agent_handoff", startedAt },
      agentHandoff: handoff,
    });
  }

  private async stream(input: CoordinatorRequest) {
    const snapshot = await this.ensureSnapshot(input);
    const clientId = createId("cf-session-client");
    let heartbeat: ReturnType<typeof setInterval> | null = null;

    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.clients.set(clientId, controller);
        this.sendEvent(
          controller,
          this.createEvent("session.snapshot", safeSnapshotData(snapshot), {
            revision: snapshot.revision,
          }),
        );
        heartbeat = setInterval(() => {
          try {
            controller.enqueue(sseEncoder.encode(encodeHeartbeat()));
          } catch {
            this.clients.delete(clientId);
            if (heartbeat) clearInterval(heartbeat);
          }
        }, sseHeartbeatMs);
      },
      cancel: () => {
        this.clients.delete(clientId);
        if (heartbeat) clearInterval(heartbeat);
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        "x-accel-buffering": "no",
      },
    });
  }

  private broadcast(input: CoordinatorRequest) {
    if (!input.event?.type) return { ok: false, error: "event.type is required", status: 400 };
    const event = this.createEvent(input.event.type, input.event.data ?? {}, {
      id: input.event.id,
      createdAt: input.event.createdAt,
      revision: input.event.revision,
    });
    this.broadcastEvent(event);
    return { ok: true, eventId: event.id };
  }

  async fetch(request: Request) {
    const input = ensureCoordinatorRequest(parseJson(await request.text()));
    if (!input)
      return json({ ok: false, error: "Invalid session coordinator request" }, { status: 400 });

    try {
      if (input.action === "stream") return this.stream(input);
      if (input.action === "broadcast") {
        const result = this.broadcast(input);
        return json(result, { status: "status" in result ? result.status : 200 });
      }
      if (input.action === "list") return json(await this.listThreads(input));
      if (input.action === "create") return json(await this.createThread(input));
      if (input.action === "stageThread") return json(await this.stageThread(input));
      if (input.action === "materializeTurn") {
        const result = await this.materializeTurn(input);
        return json(result, { status: "status" in result ? result.status : 200 });
      }
      if (input.action === "update") {
        const result = await this.updateThread(input);
        return json(result, { status: "status" in result ? result.status : 200 });
      }
      if (input.action === "activate") {
        const result = await this.activateThread(input);
        return json(result, { status: "status" in result ? result.status : 200 });
      }
      if (input.action === "switchAgent") {
        const result = await this.switchAgent(input);
        return json(result, { status: "status" in result ? result.status : 200 });
      }
      return json(await this.getSession(input));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Session coordinator failed";
      return json(
        { ok: false, error: message },
        { status: message.includes("not active") ? 403 : 500 },
      );
    }
  }
}
