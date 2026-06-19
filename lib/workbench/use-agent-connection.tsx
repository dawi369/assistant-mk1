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
  canCreateThreadFromSessionShell,
  enterLocalNewSession,
  formatCurrentThreadTitle,
  mergeSession,
  removePendingThreads,
  removeThreadsFromSession,
  sanitizeAgent,
  sanitizeThread,
  sessionEventRequiresConnectionRefresh,
  sessionFromEvent,
  shouldRefreshThreadsAfterSessionStreamOpen,
  shouldIgnoreSessionEvent,
  updateThreadStatusFromEvent,
  type PendingSessionTransition,
} from "@/lib/workbench/chat-session-state";
import { sessionEventShouldRefreshAdminSummary } from "@/lib/workbench/session-event-refresh-policy";
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
const warmupFreshMs = 15_000;

type SessionWarmupSource = "new-session" | "first-draft" | "stream-open";

type SessionAction = "read" | "create" | "activate";
type ThreadUpdateInput = {
  title?: string;
  status?: "active" | "archived" | "deleted";
  fallbackTitle?: string;
};

type OptimisticDeleteRollback = {
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
  preloadSource?: SessionWarmupSource;
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

const readSession = async (
  input: {
    action?: SessionAction;
    threadId?: string;
    refresh?: "threads";
    title?: string;
    update?: ThreadUpdateInput;
    preloadSource?: SessionWarmupSource;
  } = {},
): Promise<ChatSessionResponse> => {
  const basePath = sessionActionPath(input);
  const query = new URLSearchParams();
  if (input.refresh && input.action !== "create" && input.action !== "activate") {
    query.set("refresh", input.refresh);
  }
  if (input.preloadSource) {
    query.set("source", input.preloadSource);
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
  archivedThreads: ChatThreadSummary[];
  isLoadingArchivedThreads: boolean;
  archivedThreadsError: string | null;
  isLocalNewSession: boolean;
  deletingThreadIds: ReadonlySet<string>;
  createThread: () => Promise<void>;
  startNewSession: () => void;
  preloadNewSession: (source: SessionWarmupSource) => void;
  materializeTurn: (message: string) => Promise<void>;
  activateThread: (threadId: string) => Promise<void>;
  renameThread: (threadId: string, title: string) => Promise<void>;
  archiveThread: (threadId: string) => Promise<void>;
  restoreThread: (threadId: string) => Promise<void>;
  deleteThread: (threadId: string) => Promise<void>;
  loadArchivedThreads: () => Promise<void>;
  refresh: () => Promise<void>;
  retry: () => Promise<void>;
};

type LoadSessionInput = {
  action?: SessionAction;
  threadId?: string;
  refresh?: "threads";
  title?: string;
  update?: ThreadUpdateInput;
  optimistic?: boolean;
  preload?: boolean;
  preloadSource?: SessionWarmupSource;
  refreshSummary?: boolean;
};

const ChatSessionContext = createContext<ChatSessionContextValue | null>(null);

const isBrowser = () => typeof window !== "undefined" && typeof window.localStorage !== "undefined";

const sessionEventTypes: WorkbenchSessionEvent["type"][] = [
  "session.snapshot",
  "session.thread.created",
  "session.thread.activated",
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
  const [archivedThreads, setArchivedThreads] = useState<ChatThreadSummary[]>([]);
  const [isLoadingArchivedThreads, setIsLoadingArchivedThreads] = useState(false);
  const [archivedThreadsError, setArchivedThreadsError] = useState<string | null>(null);
  const [localNewSession, setLocalNewSession] = useState(false);
  const [deletingThreadIds, setDeletingThreadIds] = useState<ReadonlySet<string>>(() => new Set());
  const connectionRef = useRef<WorkbenchAgentConnection | null>(null);
  const localNewSessionRef = useRef(false);
  const loadSessionRef = useRef<((input?: LoadSessionInput) => Promise<void>) | null>(null);
  const sessionStreamOpenedRef = useRef(false);
  const warmupPromiseRef = useRef<Promise<void> | null>(null);
  const lastWarmupRef = useRef<{ completedAt: number; ok: boolean } | null>(null);
  const deletingThreadIdsRef = useRef<ReadonlySet<string>>(new Set());
  const deleteRollbacksRef = useRef<Map<string, OptimisticDeleteRollback>>(new Map());

  useEffect(() => {
    connectionRef.current = connection;
  }, [connection]);

  useEffect(() => {
    deletingThreadIdsRef.current = deletingThreadIds;
  }, [deletingThreadIds]);

  const applySession = useCallback(
    (nextSession: ChatSessionResponse, input?: { preserveLocalNew?: boolean }) => {
      const filteredSession =
        removeThreadsFromSession(nextSession, deletingThreadIdsRef.current) ?? nextSession;
      const effectiveSession = input?.preserveLocalNew
        ? (enterLocalNewSession(filteredSession) ?? filteredSession)
        : filteredSession;
      const nextConnection = toConnection(effectiveSession);
      if (!nextConnection && effectiveSession.activeThread) {
        throw new Error("Cloudflare Agent connection response was incomplete");
      }
      connectionRef.current = nextConnection;
      setSession((current) => {
        const merged = mergeSession(current, effectiveSession);
        writeCachedShell(merged);
        return merged;
      });
      setConnection(nextConnection);
      if (effectiveSession.activeThread && !input?.preserveLocalNew) {
        localNewSessionRef.current = false;
        setLocalNewSession(false);
      }
    },
    [],
  );

  const loadSession = useCallback(
    async (input: LoadSessionInput = {}) => {
      const startedAt = performance.now();
      let requestOk = false;
      const transition =
        input.action === "create"
          ? ({ type: "create" } as const)
          : input.action === "activate" && input.threadId
            ? ({ type: "activate", threadId: input.threadId } as const)
            : input.update?.title !== undefined && input.threadId
              ? ({ type: "rename", threadId: input.threadId } as const)
              : input.update?.status === "archived" && input.threadId
                ? ({ type: "archive", threadId: input.threadId } as const)
                : input.update?.status === "active" && input.threadId
                  ? ({ type: "restore", threadId: input.threadId } as const)
                  : input.update?.status === "deleted" && input.threadId
                    ? ({ type: "delete", threadId: input.threadId } as const)
                    : !connectionRef.current && !input.preload
                      ? ({ type: "initial" } as const)
                      : null;

      if (transition) setPending(transition);
      if (input.optimistic && input.action === "activate" && input.threadId) {
        setSession((current) => activateThreadOptimistically(current, input.threadId!));
      }

      try {
        setError(null);
        const nextSession = await readSession(input);
        requestOk = true;
        const preserveLocalNew = localNewSessionRef.current && !input.action && !input.update;
        applySession(nextSession, { preserveLocalNew });
        if (
          input.threadId &&
          (input.update?.status === "active" || input.update?.status === "deleted")
        ) {
          setArchivedThreads((current) =>
            current.filter((thread) => thread.threadId !== input.threadId),
          );
        }
        if (input.refreshSummary ?? input.action !== undefined) {
          requestWorkbenchSummaryRefresh({ source: "event" });
        }
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
        if (localNewSessionRef.current && !input.action && !input.update) {
          console.warn("Cloudflare Agent local-new preload failed", nextError);
          return;
        }
        if (
          !connectionRef.current ||
          input.action === "create" ||
          input.action === "activate" ||
          input.update
        ) {
          setError(message);
        } else {
          console.warn("Cloudflare Agent session refresh failed", nextError);
        }
      } finally {
        if (input.preload) {
          const durationMs = Math.round(performance.now() - startedAt);
          lastWarmupRef.current = { completedAt: Date.now(), ok: requestOk };
          if (process.env.NODE_ENV !== "production") {
            console.debug("Cloudflare Agent session warmup", {
              durationMs,
              ok: requestOk,
              source: input.preloadSource ?? "new-session",
            });
          }
        }
        if (transition) setPending(null);
      }
    },
    [applySession],
  );

  useEffect(() => {
    loadSessionRef.current = loadSession;
  }, [loadSession]);

  const preloadNewSession = useCallback((source: SessionWarmupSource) => {
    const lastWarmup = lastWarmupRef.current;
    if (warmupPromiseRef.current) return;
    if (lastWarmup?.ok && Date.now() - lastWarmup.completedAt < warmupFreshMs) return;
    const warmupPromise =
      loadSessionRef.current?.({
        refresh: "threads",
        refreshSummary: false,
        preload: true,
        preloadSource: source,
      }) ?? Promise.resolve();
    warmupPromiseRef.current = warmupPromise;
    warmupPromise.finally(() => {
      if (warmupPromiseRef.current === warmupPromise) {
        warmupPromiseRef.current = null;
      }
    });
  }, []);

  const startNewSession = useCallback(() => {
    localNewSessionRef.current = true;
    setLocalNewSession(true);
    setError(null);
    setPending(null);
    connectionRef.current = null;
    setConnection(null);
    setSession((current) => enterLocalNewSession(current));
    window.setTimeout(() => preloadNewSession("new-session"), 0);
  }, [preloadNewSession]);

  const materializeTurn = useCallback(
    async (message: string) => {
      const normalized = message.trim();
      if (!normalized) return;
      const startedAt = performance.now();
      const warmup = lastWarmupRef.current;
      const hadWarmSession = Boolean(warmup?.ok && Date.now() - warmup.completedAt < warmupFreshMs);
      setPending({ type: "materialize" });
      try {
        setError(null);
        const response = await fetch(`${sessionPath}/materialize-turn`, {
          method: "POST",
          cache: "no-store",
          body: JSON.stringify({ clientWarmSession: hadWarmSession, message: normalized }),
        });
        const nextSession = (await response.json().catch(() => ({}))) as ChatSessionResponse & {
          error?: string;
        };
        if (!response.ok || !nextSession.ok) {
          throw new Error(nextSession.error ?? "Failed to start chat");
        }
        localNewSessionRef.current = false;
        applySession(nextSession);
        requestWorkbenchSummaryRefresh({ source: "event" });
        if (nextSession.threadsRefreshRecommended) {
          window.setTimeout(
            () => void loadSession({ refresh: "threads", refreshSummary: false }),
            100,
          );
        }
        if (process.env.NODE_ENV !== "production") {
          console.debug("Cloudflare Agent materialize turn", {
            durationMs: Math.round(performance.now() - startedAt),
            ok: true,
            warmSession: hadWarmSession,
          });
        }
      } catch (nextError) {
        const errorMessage =
          nextError instanceof Error ? nextError.message : "Failed to start chat";
        setError(errorMessage);
        if (process.env.NODE_ENV !== "production") {
          console.debug("Cloudflare Agent materialize turn", {
            durationMs: Math.round(performance.now() - startedAt),
            ok: false,
            warmSession: hadWarmSession,
          });
        }
        throw nextError;
      } finally {
        setPending(null);
      }
    },
    [applySession, loadSession],
  );

  const restoreOptimisticDelete = useCallback((threadId: string) => {
    const rollback = deleteRollbacksRef.current.get(threadId);
    if (!rollback) return;

    if (rollback.source === "archived") {
      setArchivedThreads((current) => {
        if (current.some((thread) => thread.threadId === rollback.thread.threadId)) return current;
        const next = [...current];
        next.splice(Math.min(rollback.index, next.length), 0, rollback.thread);
        return next;
      });
    } else {
      setSession((current) => {
        const base = current ?? rollback.session;
        if (!base) return current;
        const existing = base.threads ?? [];
        const nextThreads = existing.some((thread) => thread.threadId === rollback.thread.threadId)
          ? existing
          : [
              ...existing.slice(0, rollback.index),
              rollback.thread,
              ...existing.slice(rollback.index),
            ];
        const restoredThreads = rollback.wasActive
          ? nextThreads.map((thread) => ({
              ...thread,
              isActive: thread.threadId === rollback.thread.threadId,
            }))
          : nextThreads;
        const restoredSession: ChatSessionResponse = {
          ...base,
          activeThread: rollback.wasActive ? rollback.activeThread : base.activeThread,
          connection: rollback.wasActive ? rollback.session?.connection : base.connection,
          expiresAt: rollback.wasActive ? rollback.session?.expiresAt : base.expiresAt,
          threads: restoredThreads,
        };
        writeCachedShell(restoredSession);
        return restoredSession;
      });
      if (rollback.wasActive) {
        connectionRef.current = rollback.connection;
        localNewSessionRef.current = rollback.localNewSession;
        setConnection(rollback.connection);
        setLocalNewSession(rollback.localNewSession);
      }
    }
  }, []);

  const deleteThreadOptimistically = useCallback(
    async (threadId: string) => {
      if (deletingThreadIdsRef.current.has(threadId)) return;
      const activeIndex =
        session?.threads?.findIndex((thread) => thread.threadId === threadId) ?? -1;
      const archivedIndex = archivedThreads.findIndex((thread) => thread.threadId === threadId);
      const thread =
        activeIndex >= 0 ? session?.threads?.[activeIndex] : archivedThreads[archivedIndex];
      if (!thread) {
        await loadSession({
          threadId,
          update: { status: "deleted" },
          refreshSummary: true,
        });
        return;
      }

      const wasActive = Boolean(
        activeIndex >= 0 &&
        (session?.activeThread?.threadId === threadId || session?.threads?.[activeIndex]?.isActive),
      );
      deleteRollbacksRef.current.set(threadId, {
        activeThread: session?.activeThread ?? null,
        connection: connectionRef.current,
        index: activeIndex >= 0 ? activeIndex : archivedIndex,
        localNewSession: localNewSessionRef.current,
        session,
        source: activeIndex >= 0 ? "active" : "archived",
        thread,
        wasActive,
      });
      setDeletingThreadIds((current) => {
        const next = new Set(current);
        next.add(threadId);
        deletingThreadIdsRef.current = next;
        return next;
      });

      if (activeIndex >= 0) {
        const threadIds = new Set([threadId]);
        setSession((current) => {
          const next = removeThreadsFromSession(current, threadIds);
          if (next) writeCachedShell(next);
          return next;
        });
      } else {
        setArchivedThreads((current) => current.filter((item) => item.threadId !== threadId));
      }

      if (wasActive) {
        localNewSessionRef.current = true;
        setLocalNewSession(true);
        connectionRef.current = null;
        setConnection(null);
      }

      try {
        setError(null);
        const nextSession = await readSession({
          threadId,
          update: { status: "deleted" },
        });
        applySession(nextSession);
        requestWorkbenchSummaryRefresh({ source: "event" });
        if (nextSession.threadsRefreshRecommended) {
          window.setTimeout(
            () => void loadSession({ refresh: "threads", refreshSummary: false }),
            100,
          );
        }
        deleteRollbacksRef.current.delete(threadId);
      } catch (nextError) {
        const message = nextError instanceof Error ? nextError.message : "Failed to delete chat";
        if (/thread not found/i.test(message)) {
          deleteRollbacksRef.current.delete(threadId);
          window.setTimeout(
            () => void loadSession({ refresh: "threads", refreshSummary: false }),
            100,
          );
          return;
        }
        restoreOptimisticDelete(threadId);
        deleteRollbacksRef.current.delete(threadId);
        setError(message);
        window.setTimeout(
          () => void loadSession({ refresh: "threads", refreshSummary: false }),
          100,
        );
        throw nextError;
      } finally {
        setDeletingThreadIds((current) => {
          if (!current.has(threadId)) return current;
          const next = new Set(current);
          next.delete(threadId);
          deletingThreadIdsRef.current = next;
          return next;
        });
      }
    },
    [applySession, archivedThreads, loadSession, restoreOptimisticDelete, session],
  );

  const applySessionEvent = useCallback((event: WorkbenchSessionEvent) => {
    setLatestSessionEvent(event);

    let shouldRefreshConnection = false;
    let shouldClearConnection = false;
    let refreshedThreadId: string | null = null;
    const eventSession = sessionFromEvent(event);
    if (eventSession) {
      setSession((current) => {
        if (shouldIgnoreSessionEvent(current, event)) return current;
        const passiveSnapshot =
          event.type === "session.snapshot" || event.type === "session.threads.refreshed";
        const effectiveEventSession =
          localNewSessionRef.current && passiveSnapshot
            ? (enterLocalNewSession(eventSession) ?? eventSession)
            : eventSession;
        const filteredEventSession =
          removeThreadsFromSession(effectiveEventSession, deletingThreadIdsRef.current) ??
          effectiveEventSession;
        const merged = mergeSession(current, filteredEventSession);
        writeCachedShell(merged);
        shouldRefreshConnection = sessionEventRequiresConnectionRefresh(
          event,
          merged,
          connectionRef.current,
        );
        refreshedThreadId = merged.activeThread?.threadId ?? null;
        shouldClearConnection =
          Object.prototype.hasOwnProperty.call(filteredEventSession, "activeThread") &&
          filteredEventSession.activeThread === null;
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
        void loadSessionRef.current?.({ refreshSummary: false });
      }, 0);
    } else if (shouldClearConnection) {
      connectionRef.current = null;
      setConnection(null);
    }

    if (sessionEventShouldRefreshAdminSummary(event.type)) {
      requestWorkbenchSummaryRefresh({ source: "event" });
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
        const shouldRefreshThreads = shouldRefreshThreadsAfterSessionStreamOpen(
          sessionStreamOpenedRef.current,
        );
        sessionStreamOpenedRef.current = true;
        if (shouldRefreshThreads) {
          preloadNewSession("stream-open");
        }
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
  }, [applySessionEvent, connection?.workspaceId, preloadNewSession]);

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

  const loadArchivedThreads = useCallback(async () => {
    setIsLoadingArchivedThreads(true);
    setArchivedThreadsError(null);
    try {
      const response = await fetch(`${sessionPath}/threads?status=archived`, {
        cache: "no-store",
      });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        threads?: ChatThreadSummary[];
        error?: string;
      };
      if (!response.ok || !body.ok) {
        throw new Error(body.error ?? "Failed to load archived chats");
      }
      setArchivedThreads(body.threads ?? []);
    } catch (nextError) {
      const message =
        nextError instanceof Error ? nextError.message : "Failed to load archived chats";
      setArchivedThreadsError(message);
      throw nextError;
    } finally {
      setIsLoadingArchivedThreads(false);
    }
  }, []);

  const value = useMemo<ChatSessionContextValue>(() => {
    const isLocalBlankSession =
      localNewSession ||
      Boolean(!connection && !session?.activeThread && canCreateThreadFromSessionShell(session));
    return {
      session,
      connection,
      error,
      isSessionStreamConnected,
      latestSessionEvent,
      isInitialLoading: pending?.type === "initial" && !connection,
      isTransitioning: pending !== null && pending.type !== "initial",
      pending,
      threads: session?.threads ?? [],
      archivedThreads,
      isLoadingArchivedThreads,
      archivedThreadsError,
      isLocalNewSession: isLocalBlankSession,
      deletingThreadIds,
      createThread: () => {
        void loadSession({
          action: "create",
          title: formatCurrentThreadTitle(),
          refreshSummary: true,
        });
        return Promise.resolve();
      },
      startNewSession,
      preloadNewSession,
      materializeTurn,
      activateThread: (threadId: string) =>
        loadSession({
          action: "activate",
          threadId,
          optimistic: true,
          refreshSummary: false,
        }),
      renameThread: (threadId: string, title: string) =>
        loadSession({ threadId, update: { title }, refreshSummary: true }),
      archiveThread: (threadId: string) =>
        loadSession({
          threadId,
          update: { status: "archived" },
          refreshSummary: true,
        }),
      restoreThread: (threadId: string) =>
        loadSession({ threadId, update: { status: "active" }, refreshSummary: true }),
      deleteThread: deleteThreadOptimistically,
      loadArchivedThreads,
      refresh: () => loadSession({ refresh: "threads", refreshSummary: false }),
      retry: () => loadSession({ refreshSummary: false }),
    };
  }, [
    connection,
    deletingThreadIds,
    deleteThreadOptimistically,
    error,
    isSessionStreamConnected,
    latestSessionEvent,
    isLoadingArchivedThreads,
    archivedThreadsError,
    loadArchivedThreads,
    loadSession,
    localNewSession,
    preloadNewSession,
    startNewSession,
    materializeTurn,
    archivedThreads,
    pending,
    session,
  ]);

  return <ChatSessionContext.Provider value={value}>{children}</ChatSessionContext.Provider>;
}

export const useWorkbenchAgentConnection = () => {
  const context = useContext(ChatSessionContext);
  if (!context)
    throw new Error("useWorkbenchAgentConnection must be used inside ChatSessionProvider");
  return context;
};
