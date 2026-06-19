import type {
  AgentSummary,
  ChatSessionResponse,
  ChatThreadStatus,
  ChatThreadSummary,
  WorkbenchSessionEvent,
} from "@/lib/workbench/workbench-types";

export type PendingSessionTransition =
  | { type: "initial" }
  | { type: "create" }
  | { type: "materialize" }
  | { type: "activate"; threadId: string }
  | { type: "rename"; threadId: string }
  | { type: "archive"; threadId: string }
  | { type: "restore"; threadId: string }
  | { type: "delete"; threadId: string };

export type SessionConnectionSnapshot = {
  threadId?: string;
  agentId?: string;
  workspaceId?: string;
} | null;

const nowIso = () => new Date().toISOString();

export const formatCurrentThreadTitle = (date: Date = new Date()) =>
  new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isPendingThread = (threadId?: string) => Boolean(threadId?.startsWith("pending-thread-"));

export const hasPendingActiveThread = (session: ChatSessionResponse | null) =>
  Boolean(isPendingThread(session?.activeThread?.threadId));

export const canCreateThreadFromSessionShell = (session: ChatSessionResponse | null) =>
  Boolean(session?.workspace?.id && session.activeAgent?.id);

export const enterLocalNewSession = (
  session: ChatSessionResponse | null,
): ChatSessionResponse | null =>
  session
    ? {
        ...session,
        activeThread: null,
        connection: undefined,
        expiresAt: undefined,
        pending: undefined,
        threads: (session.threads ?? []).map((thread) => ({ ...thread, isActive: false })),
      }
    : null;

export const removeThreadsFromSession = (
  session: ChatSessionResponse | null,
  threadIds: ReadonlySet<string>,
): ChatSessionResponse | null => {
  if (!session || threadIds.size === 0) return session;
  const activeRemoved = Boolean(
    session.activeThread?.threadId && threadIds.has(session.activeThread.threadId),
  );
  return {
    ...session,
    activeThread: activeRemoved ? null : session.activeThread,
    connection: activeRemoved ? undefined : session.connection,
    expiresAt: activeRemoved ? undefined : session.expiresAt,
    threads: (session.threads ?? [])
      .filter((thread) => !threadIds.has(thread.threadId))
      .map((thread) => (activeRemoved ? { ...thread, isActive: false } : thread)),
  };
};

const visibleThreadStatuses = new Set<ChatThreadStatus>(["active"]);

export const isVisibleThread = (thread?: Pick<ChatThreadSummary, "status"> | null) =>
  Boolean(thread && visibleThreadStatuses.has(thread.status as ChatThreadStatus));

export const sanitizeAgent = (agent?: AgentSummary | null): AgentSummary | null => {
  if (!agent) return null;
  return {
    ...agent,
    behavior: {
      ...agent.behavior,
      preview: undefined,
    },
  };
};

export const sanitizeThread = (thread?: ChatThreadSummary | null): ChatThreadSummary | null => {
  if (isPendingThread(thread?.threadId)) return null;
  if (!thread) return null;
  if (!isVisibleThread(thread)) return null;
  return {
    ...thread,
    agent: sanitizeAgent(thread.agent),
  };
};

export const sanitizeActiveThread = (
  thread?: ChatThreadSummary | null,
): ChatThreadSummary | null => {
  if (isPendingThread(thread?.threadId)) return null;
  if (!thread || thread.status === "deleted") return null;
  return {
    ...thread,
    agent: sanitizeAgent(thread.agent),
  };
};

const threadSortTime = (thread: ChatThreadSummary) => {
  const created = thread.createdAt ? Date.parse(thread.createdAt) : NaN;
  if (Number.isFinite(created)) return created;
  const updated = thread.updatedAt ? Date.parse(thread.updatedAt) : NaN;
  return Number.isFinite(updated) ? updated : 0;
};

export const sortThreadsByCreation = (threads: ChatThreadSummary[]) =>
  [...threads].sort((a, b) => {
    const timeDelta = threadSortTime(b) - threadSortTime(a);
    if (timeDelta !== 0) return timeDelta;
    return b.threadId.localeCompare(a.threadId);
  });

const dedupeThreads = (threads: ChatThreadSummary[]) => {
  const seen = new Set<string>();
  return threads.filter((thread) => {
    if (seen.has(thread.threadId)) return false;
    seen.add(thread.threadId);
    return true;
  });
};

const isFallbackThreadTitle = (title?: string | null) => !title || title.trim() === "New chat";

const preserveDisplayTitle = <T extends ChatThreadSummary | null>(
  incoming: T,
  current?: ChatThreadSummary,
): T => {
  if (!incoming) return incoming;
  if (
    !current?.title ||
    current.threadId !== incoming.threadId ||
    !isFallbackThreadTitle(incoming.title)
  ) {
    return incoming;
  }
  return { ...incoming, title: current.title } as T;
};

export const mergeThreads = (current: ChatThreadSummary[], incoming: ChatThreadSummary[]) => {
  const currentById = new Map(current.map((thread) => [thread.threadId, thread]));
  const incomingIds = new Set(incoming.map((thread) => thread.threadId));
  return sortThreadsByCreation(
    dedupeThreads([
      ...incoming
        .filter(isVisibleThread)
        .map((thread) => preserveDisplayTitle(thread, currentById.get(thread.threadId))),
      ...current
        .filter((thread) => !incomingIds.has(thread.threadId))
        .filter((thread) => !isPendingThread(thread.threadId))
        .filter(isVisibleThread)
        .map((thread) => ({ ...thread, isActive: false })),
    ]),
  );
};

export const mergeSession = (
  current: ChatSessionResponse | null,
  incoming: ChatSessionResponse,
): ChatSessionResponse => {
  if (!incoming.partial) return incoming;
  const hasIncomingActiveThread = Object.prototype.hasOwnProperty.call(incoming, "activeThread");
  const shouldReplaceThreads =
    hasIncomingActiveThread && incoming.activeThread === null && Array.isArray(incoming.threads);
  return {
    ...incoming,
    workspace: incoming.workspace ?? current?.workspace ?? null,
    activeAgent: incoming.activeAgent ?? current?.activeAgent ?? null,
    activeThread: hasIncomingActiveThread
      ? (preserveDisplayTitle(
          sanitizeActiveThread(incoming.activeThread),
          current?.activeThread ?? undefined,
        ) ?? null)
      : (current?.activeThread ?? null),
    threads: shouldReplaceThreads
      ? sortThreadsByCreation(
          (incoming.threads ?? [])
            .filter(isVisibleThread)
            .map((thread) => ({ ...thread, isActive: false })),
        )
      : mergeThreads(current?.threads ?? [], incoming.threads ?? []),
  };
};

export const removePendingThreads = (
  session: ChatSessionResponse | null,
): ChatSessionResponse | null =>
  session
    ? {
        ...session,
        activeThread: isPendingThread(session.activeThread?.threadId)
          ? ((session.threads ?? []).find((thread) => !isPendingThread(thread.threadId)) ?? null)
          : session.activeThread,
        threads: (session.threads ?? []).filter((thread) => !isPendingThread(thread.threadId)),
      }
    : null;

export const sessionFromEvent = (event: WorkbenchSessionEvent): ChatSessionResponse | null => {
  const data = event.data;
  if (!isRecord(data)) return null;
  const threads = Array.isArray(data.threads) ? (data.threads as ChatThreadSummary[]) : undefined;
  const revision =
    event.revision ?? (typeof data.revision === "number" ? data.revision : undefined);

  const updatedThread = isRecord(data.thread) ? (data.thread as ChatThreadSummary) : undefined;
  const eventThreads = threads
    ? updatedThread && !threads.some((thread) => thread.threadId === updatedThread.threadId)
      ? [...threads, updatedThread]
      : threads
    : updatedThread
      ? [updatedThread]
      : undefined;
  const hasActiveThread = Object.prototype.hasOwnProperty.call(data, "activeThread");
  if (!data.workspace && !data.activeAgent && !hasActiveThread && !eventThreads) {
    return null;
  }

  return {
    ok: true,
    revision,
    partial: event.type !== "session.snapshot" && event.type !== "session.threads.refreshed",
    workspace: (data.workspace as ChatSessionResponse["workspace"]) ?? undefined,
    activeAgent: (data.activeAgent as ChatSessionResponse["activeAgent"]) ?? undefined,
    activeThread: hasActiveThread
      ? ((data.activeThread as ChatSessionResponse["activeThread"]) ?? null)
      : undefined,
    threads: eventThreads,
    transition: isRecord(data.transition)
      ? (data.transition as ChatSessionResponse["transition"])
      : undefined,
  };
};

export const chatStatusFromEvent = (
  event: WorkbenchSessionEvent,
): ChatThreadSummary["latestRunStatus"] | null => {
  if (event.type === "chat.run.started") return "running";
  if (event.type === "chat.run.completed") return "completed";
  if (event.type === "chat.run.failed") return "failed";
  return null;
};

export const updateThreadStatusFromEvent = (
  session: ChatSessionResponse | null,
  event: WorkbenchSessionEvent,
  now: () => string = nowIso,
): ChatSessionResponse | null => {
  const status = chatStatusFromEvent(event);
  const threadId = typeof event.data.threadId === "string" ? event.data.threadId : null;
  if (!session || !status || !threadId) return session;

  const updateThread = (thread: ChatThreadSummary): ChatThreadSummary =>
    thread.threadId === threadId
      ? { ...thread, latestRunStatus: status, updatedAt: now() }
      : thread;

  return {
    ...session,
    activeThread: session.activeThread ? updateThread(session.activeThread) : session.activeThread,
    threads: (session.threads ?? []).map(updateThread),
  };
};

export const shouldIgnoreSessionEvent = (
  current: ChatSessionResponse | null,
  event: WorkbenchSessionEvent,
) =>
  typeof current?.revision === "number" &&
  typeof event.revision === "number" &&
  event.revision < current.revision;

export const sessionEventRequiresConnectionRefresh = (
  event: WorkbenchSessionEvent,
  session: ChatSessionResponse | null,
  connection: SessionConnectionSnapshot,
) => {
  if (event.type !== "session.thread.created" && event.type !== "session.thread.activated") {
    if (event.type !== "session.thread.updated") return false;
    const transition = isRecord(event.data.transition) ? event.data.transition : null;
    if (transition?.type !== "archive" && transition?.type !== "delete") return false;
  }
  if (!session?.activeThread?.threadId || !session.activeAgent?.id) return false;
  return (
    connection?.threadId !== session.activeThread.threadId ||
    connection?.agentId !== session.activeAgent.id ||
    connection?.workspaceId !== session.workspace?.id
  );
};

export const shouldRefreshThreadsAfterSessionStreamOpen = (hasOpenedBefore: boolean) =>
  hasOpenedBefore;

export const activateThreadOptimistically = (
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

export const createPendingThreadOptimistically = (
  session: ChatSessionResponse | null,
  createId: () => string = () => crypto.randomUUID(),
  now: () => string = nowIso,
  title?: string,
): ChatSessionResponse | null => {
  if (!session?.workspace || !session.activeAgent) return session;
  const timestamp = now();
  const pendingThread: ChatThreadSummary = {
    threadId: `pending-thread-${createId()}`,
    sessionId: session.activeThread?.sessionId ?? "pending-session",
    agentId: session.activeAgent.id,
    agent: session.activeAgent,
    status: "pending",
    title: title ?? formatCurrentThreadTitle(new Date(timestamp)),
    createdAt: timestamp,
    updatedAt: timestamp,
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
