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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isPendingThread = (threadId?: string) => Boolean(threadId?.startsWith("pending-thread-"));

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

const dedupeThreads = (threads: ChatThreadSummary[]) => {
  const seen = new Set<string>();
  return threads.filter((thread) => {
    if (seen.has(thread.threadId)) return false;
    seen.add(thread.threadId);
    return true;
  });
};

export const mergeThreads = (current: ChatThreadSummary[], incoming: ChatThreadSummary[]) => {
  const incomingIds = new Set(incoming.map((thread) => thread.threadId));
  return dedupeThreads([
    ...incoming.filter(isVisibleThread),
    ...current
      .filter((thread) => !incomingIds.has(thread.threadId))
      .filter((thread) => !isPendingThread(thread.threadId))
      .filter(isVisibleThread)
      .map((thread) => ({ ...thread, isActive: false })),
  ]);
};

export const mergeSession = (
  current: ChatSessionResponse | null,
  incoming: ChatSessionResponse,
): ChatSessionResponse => {
  if (!incoming.partial) return incoming;
  return {
    ...incoming,
    workspace: incoming.workspace ?? current?.workspace ?? null,
    activeAgent: incoming.activeAgent ?? current?.activeAgent ?? null,
    activeThread: sanitizeThread(incoming.activeThread) ?? current?.activeThread ?? null,
    threads: mergeThreads(current?.threads ?? [], incoming.threads ?? []),
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
  if (!data.workspace && !data.activeAgent && !data.activeThread && !eventThreads) {
    return null;
  }

  return {
    ok: true,
    revision,
    partial: event.type !== "session.snapshot" && event.type !== "session.threads.refreshed",
    workspace: (data.workspace as ChatSessionResponse["workspace"]) ?? undefined,
    activeAgent: (data.activeAgent as ChatSessionResponse["activeAgent"]) ?? undefined,
    activeThread: (data.activeThread as ChatSessionResponse["activeThread"]) ?? undefined,
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
): ChatSessionResponse | null => {
  if (!session?.workspace || !session.activeAgent) return session;
  const pendingThread: ChatThreadSummary = {
    threadId: `pending-thread-${createId()}`,
    sessionId: session.activeThread?.sessionId ?? "pending-session",
    agentId: session.activeAgent.id,
    agent: session.activeAgent,
    status: "pending",
    title: "New chat",
    createdAt: now(),
    updatedAt: now(),
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
