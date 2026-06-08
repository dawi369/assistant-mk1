import type { RemoteThreadListAdapter } from "@assistant-ui/react";

import type {
  ChatThreadResponse,
  ChatThreadSummary,
  ChatThreadsResponse,
} from "@/lib/workbench/workbench-types";

const readJson = async <T>(response: Response, fallback: string) => {
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? fallback);
  return body;
};

const toRemoteThread = (thread: ChatThreadSummary) => ({
  status: "regular" as const,
  remoteId: thread.threadId,
  externalId: thread.threadId,
  title: thread.title,
  custom: {
    sessionId: thread.sessionId,
    agentId: thread.agentId,
    status: thread.status,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    lastSeenAt: thread.lastSeenAt,
    isActive: thread.isActive,
    latestRunStatus: thread.latestRunStatus,
    messageCount: thread.messageCount,
  },
});

export const createWorkbenchThreadListAdapter = (input: {
  createThread: () => Promise<{ thread_id?: string }>;
}): RemoteThreadListAdapter => ({
  async list() {
    const response = await fetch("/api/workbench/chat-threads?limit=30", {
      cache: "no-store",
    });
    const body = await readJson<ChatThreadsResponse>(response, "Failed to load recent chats");
    return {
      threads: (body.threads ?? []).map(toRemoteThread),
    };
  },
  async initialize() {
    const thread = await input.createThread();
    if (!thread.thread_id) throw new Error("thread_id missing");
    return {
      remoteId: thread.thread_id,
      externalId: thread.thread_id,
    };
  },
  async fetch(threadId) {
    const response = await fetch(`/api/workbench/chat-threads/${encodeURIComponent(threadId)}`, {
      cache: "no-store",
    });
    const body = await readJson<ChatThreadResponse>(response, "Failed to load chat thread");
    if (!body.thread) throw new Error("Thread not found");
    return toRemoteThread(body.thread);
  },
  async rename() {},
  async archive() {},
  async unarchive() {},
  async delete() {},
  async generateTitle() {
    return new ReadableStream();
  },
});
