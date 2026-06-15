"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { requestWorkbenchSummaryRefresh } from "@/lib/workbench/admin-summary-events";
import {
  activateThreadOptimistically,
  createPendingThreadOptimistically,
  mergeSession,
  removePendingThreads,
  sanitizeAgent,
  sanitizeThread,
  sessionEventRequiresConnectionRefresh,
  sessionFromEvent,
  shouldIgnoreSessionEvent,
  updateThreadStatusFromEvent,
  type PendingSessionTransition,
} from "@/lib/workbench/chat-session-state";
import type {
  AgentSummary,
  ChatSessionResponse,
  ChatThreadSummary,
  WorkbenchSessionEvent,
} from "@/lib/workbench/workbench-types";

const sessionPath = "/api/workbench/chat-session";
const tokenRefreshSkewMs = 60_000;
const minimumRefreshDelayMs = 5_000;
const cacheTtlMs = 12 * 60 * 60 * 1000;
const cacheVersion = 1;
const lastSessionShellCacheKey = "assistant-mk1:chat-session:last";

type SessionAction = "read" | "create" | "activate";

const readSession = async (
  input: {
    action?: SessionAction;
    threadId?: string;
    refresh?: "threads";
  } = {},
): Promise<ChatSessionResponse> => {
  const basePath =
    input.action === "create"
      ? `${sessionPath}/threads`
      : input.action === "activate" && input.threadId
        ? `${sessionPath}/threads/${encodeURIComponent(input.threadId)}/activate`
        : sessionPath;
  const path =
    input.refresh && input.action !== "create" && input.action !== "activate"
      ? `${basePath}?refresh=${encodeURIComponent(input.refresh)}`
      : basePath;
  const response = await fetch(path, {
    method: input.action === "create" || input.action === "activate" ? "POST" : "GET",
    cache: "no-store",
  });
  const body = (await response.json().catch(() => ({}))) as ChatSessionResponse & {
    error?: string;
  };
  if (!response.ok || !body.ok) {
    throw new Error(body.error ?? "Failed to load Cloudflare chat session");
  }
  if (
    !body.connection?.agentHost ||
    !body.connection.agentName ||
    !body.connection.instanceName ||
    !body.connection.token
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

type ChatSessionContextValue = {
  session: ChatSessionResponse | null;
  connection: WorkbenchAgentConnection | null;
  error: string | null;
  isSessionStreamConnected: boolean;
  latestSessionEvent: WorkbenchSessionEvent | null;
  isInitialLoading: boolean;
  isTransitioning: boolean;
  pending: PendingSessionTransition | null;
  threads: ChatThreadSummary[];
  createThread: () => Promise<void>;
  activateThread: (threadId: string) => Promise<void>;
  refresh: () => Promise<void>;
  retry: () => Promise<void>;
};

type LoadSessionInput = {
  action?: SessionAction;
  threadId?: string;
  refresh?: "threads";
  optimistic?: boolean;
  refreshSummary?: boolean;
};

const ChatSessionContext = createContext<ChatSessionContextValue | null>(null);

const isBrowser = () => typeof window !== "undefined" && typeof window.localStorage !== "undefined";

const sessionEventTypes: WorkbenchSessionEvent["type"][] = [
  "session.snapshot",
  "session.thread.created",
  "session.thread.activated",
  "session.threads.refreshed",
  "chat.run.started",
  "chat.run.completed",
  "chat.run.failed",
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

const readInitialCachedShell = () => readCachedShell(lastSessionShellCacheKey);

const writeCachedShell = (session: ChatSessionResponse) => {
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

const sessionFromCachedShell = (shell: CachedChatSessionShell | null): ChatSessionResponse | null =>
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

const toConnection = (session: ChatSessionResponse): WorkbenchAgentConnection | null =>
  session.connection
    ? {
        ...session.connection,
        expiresAt: session.connection.expiresAt ?? session.expiresAt,
      }
    : null;

export function ChatSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<ChatSessionResponse | null>(() =>
    sessionFromCachedShell(readInitialCachedShell()),
  );
  const [connection, setConnection] = useState<WorkbenchAgentConnection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSessionStreamConnected, setIsSessionStreamConnected] = useState(false);
  const [latestSessionEvent, setLatestSessionEvent] = useState<WorkbenchSessionEvent | null>(null);
  const [pending, setPending] = useState<PendingSessionTransition | null>({ type: "initial" });
  const connectionRef = useRef<WorkbenchAgentConnection | null>(null);
  const loadSessionRef = useRef<((input?: LoadSessionInput) => Promise<void>) | null>(null);

  useEffect(() => {
    connectionRef.current = connection;
  }, [connection]);

  const applySession = useCallback((nextSession: ChatSessionResponse) => {
    const nextConnection = toConnection(nextSession);
    if (!nextConnection) {
      throw new Error("Cloudflare Agent connection response was incomplete");
    }
    setSession((current) => {
      const merged = mergeSession(current, nextSession);
      writeCachedShell(merged);
      return merged;
    });
    setConnection(nextConnection);
  }, []);

  const loadSession = useCallback(
    async (input: LoadSessionInput = {}) => {
      const transition =
        input.action === "create"
          ? ({ type: "create" } as const)
          : input.action === "activate" && input.threadId
            ? ({ type: "activate", threadId: input.threadId } as const)
            : !connectionRef.current
              ? ({ type: "initial" } as const)
              : null;

      if (transition) setPending(transition);
      if (input.action === "create") {
        setSession((current) => createPendingThreadOptimistically(current));
      }
      if (input.optimistic && input.action === "activate" && input.threadId) {
        setSession((current) => activateThreadOptimistically(current, input.threadId!));
      }

      try {
        setError(null);
        const nextSession = await readSession(input);
        applySession(nextSession);
        if (input.refreshSummary ?? input.action !== undefined) requestWorkbenchSummaryRefresh();
        if (nextSession.threadsRefreshRecommended && input.action !== undefined) {
          window.setTimeout(
            () => void loadSession({ refresh: "threads", refreshSummary: false }),
            100,
          );
        }
      } catch (nextError) {
        const message = nextError instanceof Error ? nextError.message : "Agent connection failed";
        if (input.action === "create") {
          setSession((current) => removePendingThreads(current));
        }
        if (!connectionRef.current || input.action === "create" || input.action === "activate") {
          setError(message);
        } else {
          console.warn("Cloudflare Agent session refresh failed", nextError);
        }
      } finally {
        if (transition) setPending(null);
      }
    },
    [applySession],
  );

  useEffect(() => {
    loadSessionRef.current = loadSession;
  }, [loadSession]);

  const applySessionEvent = useCallback((event: WorkbenchSessionEvent) => {
    setLatestSessionEvent(event);

    let shouldRefreshConnection = false;
    let refreshedThreadId: string | null = null;
    const eventSession = sessionFromEvent(event);
    if (eventSession) {
      setSession((current) => {
        if (shouldIgnoreSessionEvent(current, event)) return current;
        const merged = mergeSession(current, eventSession);
        writeCachedShell(merged);
        shouldRefreshConnection = sessionEventRequiresConnectionRefresh(
          event,
          merged,
          connectionRef.current,
        );
        refreshedThreadId = merged.activeThread?.threadId ?? null;
        return merged;
      });
      if (event.type === "session.threads.refreshed") {
        setPending(null);
      }
    } else {
      setSession((current) =>
        shouldIgnoreSessionEvent(current, event)
          ? current
          : updateThreadStatusFromEvent(current, event),
      );
    }

    if (shouldRefreshConnection) {
      if (refreshedThreadId) setPending({ type: "activate", threadId: refreshedThreadId });
      window.setTimeout(() => {
        void loadSessionRef.current?.({ refreshSummary: true });
      }, 0);
    }

    if (
      event.type === "admin.summary.invalidated" ||
      event.type === "approval.updated" ||
      event.type === "chat.run.completed" ||
      event.type === "chat.run.failed" ||
      event.type === "tool.run.updated" ||
      event.type === "trace.updated"
    ) {
      requestWorkbenchSummaryRefresh();
    }
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  useEffect(() => {
    if (!connection?.workspaceId) return;

    let closed = false;
    let source: EventSource | null = null;
    let reconnectTimeout: number | null = null;

    const connect = () => {
      if (closed) return;
      source = new EventSource("/api/workbench/chat-session/stream");

      source.onopen = () => {
        setIsSessionStreamConnected(true);
      };

      const onEvent = (message: MessageEvent<string>) => {
        try {
          const event = JSON.parse(message.data) as WorkbenchSessionEvent;
          applySessionEvent(event);
        } catch (parseError) {
          console.warn("Failed to parse Workbench session event", parseError);
        }
      };

      for (const type of sessionEventTypes) {
        source.addEventListener(type, onEvent as EventListener);
      }

      source.onerror = () => {
        setIsSessionStreamConnected(false);
        source?.close();
        if (!closed) {
          reconnectTimeout = window.setTimeout(connect, 2_000);
        }
      };
    };

    connect();

    return () => {
      closed = true;
      setIsSessionStreamConnected(false);
      source?.close();
      if (reconnectTimeout) window.clearTimeout(reconnectTimeout);
    };
  }, [applySessionEvent, connection?.workspaceId]);

  useEffect(() => {
    if (!connection?.expiresAt) return;

    const expiresAtMs = Date.parse(connection.expiresAt);
    if (!Number.isFinite(expiresAtMs)) return;

    const refreshDelayMs = Math.max(
      minimumRefreshDelayMs,
      expiresAtMs - Date.now() - tokenRefreshSkewMs,
    );
    const timeout = window.setTimeout(
      () => void loadSession({ refreshSummary: false }),
      refreshDelayMs,
    );
    return () => window.clearTimeout(timeout);
  }, [connection?.expiresAt, loadSession]);

  const value = useMemo<ChatSessionContextValue>(
    () => ({
      session,
      connection,
      error,
      isSessionStreamConnected,
      latestSessionEvent,
      isInitialLoading: pending?.type === "initial" && !connection,
      isTransitioning: pending !== null && pending.type !== "initial",
      pending,
      threads: session?.threads ?? [],
      createThread: () => loadSession({ action: "create", refreshSummary: true }),
      activateThread: (threadId: string) =>
        loadSession({
          action: "activate",
          threadId,
          optimistic: true,
          refreshSummary: true,
        }),
      refresh: () => loadSession({ refresh: "threads", refreshSummary: false }),
      retry: () => loadSession({ refreshSummary: false }),
    }),
    [
      connection,
      error,
      isSessionStreamConnected,
      latestSessionEvent,
      loadSession,
      pending,
      session,
    ],
  );

  return <ChatSessionContext.Provider value={value}>{children}</ChatSessionContext.Provider>;
}

export const useWorkbenchAgentConnection = () => {
  const context = useContext(ChatSessionContext);
  if (!context)
    throw new Error("useWorkbenchAgentConnection must be used inside ChatSessionProvider");
  return context;
};
