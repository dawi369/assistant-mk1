import {
  sanitizeAgent,
  sanitizeThread,
  type PendingSessionTransition,
} from "@/lib/workbench/chat-session-state";
import type {
  AgentSummary,
  AgentSwitchTarget,
  ChatSessionResponse,
  ChatThreadSummary,
  WorkbenchSessionEvent,
} from "@/lib/workbench/workbench-types";

export const sessionPath = "/api/workbench/chat-session";
export const agentSwitchPath = "/api/workbench/chat-session/agent-switch";
export const tokenRefreshSkewMs = 60_000;
export const minimumRefreshDelayMs = 5_000;
const cacheTtlMs = 12 * 60 * 60 * 1000;
const cacheVersion = 1;
const lastSessionShellCacheKey = "assistant-mk1:chat-session:last";
export const warmupFreshMs = 15_000;
export const archivedThreadsFreshMs = 60_000;

export type ArchivedThreadsLoadInput = {
  force?: boolean;
};

export type SessionWarmupSource = "new-session" | "first-draft" | "stream-open";
export type SessionStageSource =
  | "new-session"
  | "first-focus"
  | "first-draft"
  | "first-send"
  | "retry";
export type SessionReadSource =
  | SessionWarmupSource
  | "post-action"
  | "post-delete"
  | "post-materialize"
  | "manual";

type SessionAction = "read" | "create" | "activate";
export type ThreadUpdateInput = {
  title?: string;
  status?: "active" | "archived" | "deleted";
  fallbackTitle?: string;
};

export type OptimisticDeleteRollback = {
  thread: ChatThreadSummary;
  source: "active" | "archived";
  index: number;
  wasActive: boolean;
  activeThread: ChatThreadSummary | null;
  connection: WorkbenchAgentConnection | null;
  localNewSession: boolean;
  session: ChatSessionResponse | null;
};

const sessionActionPath = (input: {
  action?: SessionAction;
  threadId?: string;
  update?: ThreadUpdateInput;
  source?: SessionReadSource;
}) => {
  if (input.action === "create") return `${sessionPath}/threads`;
  if (input.action === "activate" && input.threadId) {
    return `${sessionPath}/threads/${encodeURIComponent(input.threadId)}/activate`;
  }
  if (input.update && input.threadId) {
    return `${sessionPath}/threads/${encodeURIComponent(input.threadId)}`;
  }
  return sessionPath;
};

const sessionRequestMethod = (input: { action?: SessionAction; update?: ThreadUpdateInput }) => {
  if (input.update) return "PATCH";
  if (input.action === "create" || input.action === "activate") return "POST";
  return "GET";
};

export const readSession = async (
  input: {
    action?: SessionAction;
    threadId?: string;
    refresh?: "threads";
    title?: string;
    update?: ThreadUpdateInput;
    source?: SessionReadSource;
  } = {},
): Promise<ChatSessionResponse> => {
  const basePath = sessionActionPath(input);
  const query = new URLSearchParams();
  if (input.refresh && input.action !== "create" && input.action !== "activate") {
    query.set("refresh", input.refresh);
  }
  if (input.source) {
    query.set("source", input.source);
  }
  const path = query.size > 0 ? `${basePath}?${query.toString()}` : basePath;
  const requestBody = input.update
    ? input.update
    : input.action === "create" && input.title
      ? { title: input.title }
      : undefined;
  const response = await fetch(path, {
    method: sessionRequestMethod(input),
    cache: "no-store",
    body: requestBody ? JSON.stringify(requestBody) : undefined,
  });
  const body = (await response.json().catch(() => ({}))) as ChatSessionResponse & {
    error?: string;
  };
  if (!response.ok || !body.ok) {
    throw new Error(body.error ?? "Failed to load Cloudflare chat session");
  }
  if (
    body.activeThread &&
    (!body.connection?.agentHost ||
      !body.connection.agentName ||
      !body.connection.instanceName ||
      !body.connection.token)
  ) {
    throw new Error("Cloudflare Agent connection response was incomplete");
  }
  return body;
};

export type WorkbenchAgentConnection = NonNullable<ChatSessionResponse["connection"]> & {
  expiresAt?: string;
};

export type CachedChatSessionShell = {
  version: typeof cacheVersion;
  cachedAt: number;
  revision?: number;
  workspace: NonNullable<ChatSessionResponse["workspace"]>;
  activeAgent?: AgentSummary | null;
  activeThread?: ChatThreadSummary | null;
  threads: ChatThreadSummary[];
};

export type ChatSessionContextValue = {
  session: ChatSessionResponse | null;
  connection: WorkbenchAgentConnection | null;
  error: string | null;
  isSessionStreamConnected: boolean;
  latestSessionEvent: WorkbenchSessionEvent | null;
  isInitialLoading: boolean;
  isTransitioning: boolean;
  pending: PendingSessionTransition | null;
  threads: ChatThreadSummary[];
  archivedThreads: ChatThreadSummary[];
  isLoadingArchivedThreads: boolean;
  archivedThreadsError: string | null;
  isLocalNewSession: boolean;
  deletingThreadIds: ReadonlySet<string>;
  createThread: () => Promise<void>;
  startNewSession: () => void;
  preloadNewSession: (source: SessionWarmupSource) => void;
  stageNewSession: (source: SessionStageSource) => Promise<ChatSessionResponse | null>;
  materializeTurn: (message: string) => Promise<void>;
  switchAgent: (agentId: string, target: AgentSwitchTarget, threadId?: string) => Promise<void>;
  activateThread: (threadId: string) => Promise<void>;
  renameThread: (threadId: string, title: string) => Promise<void>;
  archiveThread: (threadId: string) => Promise<void>;
  restoreThread: (threadId: string) => Promise<void>;
  deleteThread: (threadId: string) => Promise<void>;
  loadArchivedThreads: (input?: ArchivedThreadsLoadInput) => Promise<void>;
  refresh: () => Promise<void>;
  retry: () => Promise<void>;
};

export type LoadSessionInput = {
  action?: SessionAction;
  threadId?: string;
  refresh?: "threads";
  title?: string;
  update?: ThreadUpdateInput;
  optimistic?: boolean;
  preload?: boolean;
  source?: SessionReadSource;
  refreshSummary?: boolean;
};

const isBrowser = () => typeof window !== "undefined" && typeof window.localStorage !== "undefined";

export const sessionEventTypes: WorkbenchSessionEvent["type"][] = [
  "session.snapshot",
  "session.thread.created",
  "session.thread.activated",
  "session.agent.handoff",
  "session.thread.updated",
  "session.threads.refreshed",
  "chat.run.started",
  "chat.run.completed",
  "chat.run.failed",
  "workflow.run.updated",
  "approval.updated",
  "tool.run.updated",
  "trace.updated",
  "admin.summary.invalidated",
];

const workspaceCacheKey = (workspaceId: string) => `assistant-mk1:chat-session:${workspaceId}`;

const cachedShellFromSession = (session: ChatSessionResponse): CachedChatSessionShell | null => {
  if (!session.workspace) return null;
  return {
    version: cacheVersion,
    cachedAt: Date.now(),
    revision: session.revision,
    workspace: session.workspace,
    activeAgent: sanitizeAgent(session.activeAgent),
    activeThread: sanitizeThread(session.activeThread),
    threads: (session.threads ?? []).reduce<ChatThreadSummary[]>((threads, thread) => {
      const sanitized = sanitizeThread(thread);
      if (sanitized) threads.push(sanitized);
      return threads;
    }, []),
  };
};

const isCachedShell = (value: unknown): value is CachedChatSessionShell => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<CachedChatSessionShell>;
  return (
    candidate.version === cacheVersion &&
    typeof candidate.cachedAt === "number" &&
    Date.now() - candidate.cachedAt <= cacheTtlMs &&
    Boolean(candidate.workspace?.id) &&
    Array.isArray(candidate.threads)
  );
};

const readCachedShell = (key: string): CachedChatSessionShell | null => {
  if (!isBrowser()) return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "null") as unknown;
    return isCachedShell(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const readInitialCachedShell = () => readCachedShell(lastSessionShellCacheKey);

export const writeCachedShell = (session: ChatSessionResponse) => {
  const shell = cachedShellFromSession(session);
  if (!shell || !isBrowser()) return;
  try {
    const payload = JSON.stringify(shell);
    window.localStorage.setItem(workspaceCacheKey(shell.workspace.id), payload);
    window.localStorage.setItem(lastSessionShellCacheKey, payload);
  } catch {
    // Cache writes are UX-only and must never block the trusted session path.
  }
};

export const sessionFromCachedShell = (
  shell: CachedChatSessionShell | null,
): ChatSessionResponse | null =>
  shell
    ? {
        ok: true,
        revision: shell.revision,
        isStale: true,
        partial: true,
        workspace: shell.workspace,
        activeAgent: shell.activeAgent,
        activeThread: shell.activeThread,
        threads: shell.threads,
      }
    : null;

export const toConnection = (session: ChatSessionResponse): WorkbenchAgentConnection | null =>
  session.connection
    ? {
        ...session.connection,
        expiresAt: session.connection.expiresAt ?? session.expiresAt,
      }
    : null;
