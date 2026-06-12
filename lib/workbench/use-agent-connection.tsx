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

type PendingSessionTransition =
  | { type: "initial" }
  | { type: "create" }
  | { type: "activate"; threadId: string };

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

const ChatSessionContext = createContext<ChatSessionContextValue | null>(null);

const nowIso = () => new Date().toISOString();

const isBrowser = () => typeof window !== "undefined" && typeof window.localStorage !== "undefined";

const sessionEventTypes: WorkbenchSessionEvent["type"][] = [
  "session.snapshot",
  "session.thread.created",
  "session.thread.activated",
  "session.threads.refreshed",
  "chat.run.started",
  "chat.run.completed",
  "chat.run.failed",
  "tool.run.updated",
  "trace.updated",
  "admin.summary.invalidated",
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const workspaceCacheKey = (workspaceId: string) => `assistant-mk1:chat-session:${workspaceId}`;

const sanitizeAgent = (agent?: AgentSummary | null): AgentSummary | null => {
  if (!agent) return null;
  return {
    ...agent,
    behavior: {
      ...agent.behavior,
      preview: undefined,
    },
  };
};

const sanitizeThread = (thread?: ChatThreadSummary | null): ChatThreadSummary | null => {
  if (thread?.threadId.startsWith("pending-thread-")) return null;
  if (!thread) return null;
  return {
    ...thread,
    agent: sanitizeAgent(thread.agent),
  };
};

const dedupeThreads = (threads: ChatThreadSummary[]) => {
  const seen = new Set<string>();
  return threads.filter((thread) => {
    if (seen.has(thread.threadId)) return false;
    seen.add(thread.threadId);
    return true;
  });
};

const mergeThreads = (current: ChatThreadSummary[], incoming: ChatThreadSummary[]) => {
  const incomingIds = new Set(incoming.map((thread) => thread.threadId));
  return dedupeThreads([
    ...incoming,
    ...current
      .filter((thread) => !incomingIds.has(thread.threadId))
      .filter((thread) => !thread.threadId.startsWith("pending-thread-"))
      .map((thread) => ({ ...thread, isActive: false })),
  ]);
};

const removePendingThreads = (session: ChatSessionResponse | null): ChatSessionResponse | null =>
  session
    ? {
        ...session,
        activeThread: session.activeThread?.threadId.startsWith("pending-thread-")
          ? ((session.threads ?? []).find(
              (thread) => !thread.threadId.startsWith("pending-thread-"),
            ) ?? null)
          : session.activeThread,
        threads: (session.threads ?? []).filter(
          (thread) => !thread.threadId.startsWith("pending-thread-"),
        ),
      }
    : null;

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

const mergeSession = (
  current: ChatSessionResponse | null,
  incoming: ChatSessionResponse,
): ChatSessionResponse => {
  if (!incoming.partial) return incoming;
  return {
    ...incoming,
    workspace: incoming.workspace ?? current?.workspace ?? null,
    activeAgent: incoming.activeAgent ?? current?.activeAgent ?? null,
    activeThread: incoming.activeThread ?? current?.activeThread ?? null,
    threads: mergeThreads(current?.threads ?? [], incoming.threads ?? []),
  };
};

const sessionFromEvent = (event: WorkbenchSessionEvent): ChatSessionResponse | null => {
  const data = event.data;
  if (!isRecord(data)) return null;
  const threads = Array.isArray(data.threads) ? (data.threads as ChatThreadSummary[]) : undefined;
  const revision =
    event.revision ?? (typeof data.revision === "number" ? data.revision : undefined);

  if (!data.workspace && !data.activeAgent && !data.activeThread && !threads) return null;

  return {
    ok: true,
    revision,
    partial: event.type !== "session.snapshot" && event.type !== "session.threads.refreshed",
    workspace: (data.workspace as ChatSessionResponse["workspace"]) ?? undefined,
    activeAgent: (data.activeAgent as ChatSessionResponse["activeAgent"]) ?? undefined,
    activeThread: (data.activeThread as ChatSessionResponse["activeThread"]) ?? undefined,
    threads,
    transition: isRecord(data.transition)
      ? (data.transition as ChatSessionResponse["transition"])
      : undefined,
  };
};

const chatStatusFromEvent = (
  event: WorkbenchSessionEvent,
): ChatThreadSummary["latestRunStatus"] | null => {
  if (event.type === "chat.run.started") return "running";
  if (event.type === "chat.run.completed") return "completed";
  if (event.type === "chat.run.failed") return "failed";
  return null;
};

const updateThreadStatusFromEvent = (
  session: ChatSessionResponse | null,
  event: WorkbenchSessionEvent,
): ChatSessionResponse | null => {
  const status = chatStatusFromEvent(event);
  const threadId = typeof event.data.threadId === "string" ? event.data.threadId : null;
  if (!session || !status || !threadId) return session;

  const updateThread = (thread: ChatThreadSummary): ChatThreadSummary =>
    thread.threadId === threadId
      ? { ...thread, latestRunStatus: status, updatedAt: nowIso() }
      : thread;

  return {
    ...session,
    activeThread: session.activeThread ? updateThread(session.activeThread) : session.activeThread,
    threads: (session.threads ?? []).map(updateThread),
  };
};

const toConnection = (session: ChatSessionResponse): WorkbenchAgentConnection | null =>
  session.connection
    ? {
        ...session.connection,
        expiresAt: session.connection.expiresAt ?? session.expiresAt,
      }
    : null;

const activateThreadOptimistically = (
  session: ChatSessionResponse | null,
  threadId: string,
): ChatSessionResponse | null => {
  if (!session?.threads?.length) return session;
  const activeThread = session.threads.find((thread) => thread.threadId === threadId);
  return {
    ...session,
    activeThread: activeThread ?? session.activeThread,
    activeAgent: activeThread?.agent ?? session.activeAgent,
    threads: session.threads.map((thread) => ({
      ...thread,
      isActive: thread.threadId === threadId,
    })),
    pending: { type: "activate", threadId },
  };
};

const createPendingThreadOptimistically = (
  session: ChatSessionResponse | null,
): ChatSessionResponse | null => {
  if (!session?.workspace || !session.activeAgent) return session;
  const pendingThread: ChatThreadSummary = {
    threadId: `pending-thread-${crypto.randomUUID()}`,
    sessionId: session.activeThread?.sessionId ?? "pending-session",
    agentId: session.activeAgent.id,
    agent: session.activeAgent,
    status: "pending",
    title: "New chat",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    isActive: true,
    messageCount: 0,
  };
  return {
    ...session,
    activeThread: pendingThread,
    threads: [
      pendingThread,
      ...(session.threads ?? []).map((thread) => ({ ...thread, isActive: false })),
    ],
    pending: { type: "create" },
  };
};

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

  const applySessionEvent = useCallback((event: WorkbenchSessionEvent) => {
    setLatestSessionEvent(event);

    const eventSession = sessionFromEvent(event);
    if (eventSession) {
      setSession((current) => {
        const merged = mergeSession(current, eventSession);
        writeCachedShell(merged);
        return merged;
      });
      if (
        event.type === "session.thread.created" ||
        event.type === "session.thread.activated" ||
        event.type === "session.threads.refreshed"
      ) {
        setPending(null);
      }
    } else {
      setSession((current) => updateThreadStatusFromEvent(current, event));
    }

    if (
      event.type === "admin.summary.invalidated" ||
      event.type === "chat.run.completed" ||
      event.type === "chat.run.failed" ||
      event.type === "tool.run.updated" ||
      event.type === "trace.updated"
    ) {
      requestWorkbenchSummaryRefresh();
    }
  }, []);

  const loadSession = useCallback(
    async (
      input: {
        action?: SessionAction;
        threadId?: string;
        refresh?: "threads";
        optimistic?: boolean;
        refreshSummary?: boolean;
      } = {},
    ) => {
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
