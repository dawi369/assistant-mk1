import { describe, expect, it } from "vitest";

import {
  activateThreadOptimistically,
  createPendingThreadOptimistically,
  mergeSession,
  removePendingThreads,
  sessionEventRequiresConnectionRefresh,
  sessionFromEvent,
  shouldIgnoreSessionEvent,
  updateThreadStatusFromEvent,
} from "./chat-session-state";
import type {
  AgentSummary,
  ChatSessionResponse,
  ChatThreadSummary,
  WorkbenchSessionEvent,
} from "./workbench-types";

const workspace = {
  id: "workspace-1",
  name: "Workspace 1",
  status: "active",
  isDefault: true,
};

const agent = (id: string): AgentSummary => ({
  id,
  name: id,
  description: null,
  status: "active",
  isDefault: id === "agent-a",
  isActive: id === "agent-a",
  profile: "default",
  runtime: {
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash",
    temperature: 0.4,
    maxTokens: 1200,
    source: "system-default",
  },
  behavior: {
    profile: "default",
    source: "server-preset",
    version: "default",
    instructionId: "preset:default",
  },
});

const thread = (id: string, active = false, threadAgent = agent("agent-a")): ChatThreadSummary => ({
  threadId: id,
  sessionId: "session-1",
  agentId: threadAgent.id,
  agent: threadAgent,
  status: "active",
  title: id,
  isActive: active,
  messageCount: 0,
});

const session = (input: Partial<ChatSessionResponse> = {}): ChatSessionResponse => ({
  ok: true,
  revision: 1,
  workspace,
  activeAgent: agent("agent-a"),
  activeThread: thread("thread-a", true),
  threads: [thread("thread-a", true)],
  ...input,
});

const event = (
  type: WorkbenchSessionEvent["type"],
  data: WorkbenchSessionEvent["data"],
  revision = 2,
): WorkbenchSessionEvent => ({
  id: `event-${type}`,
  type,
  revision,
  createdAt: "2026-06-13T00:00:00.000Z",
  data,
});

describe("chat-session-state", () => {
  it("replaces stale state with a full snapshot", () => {
    const incoming = session({
      revision: 11,
      partial: false,
      activeThread: thread("thread-b", true),
      threads: [thread("thread-b", true)],
    });

    const merged = mergeSession(session({ revision: 10 }), incoming);

    expect(merged.revision).toBe(11);
    expect(merged.activeThread?.threadId).toBe("thread-b");
    expect(merged.threads?.map((item) => item.threadId)).toEqual(["thread-b"]);
  });

  it("merges a token-free thread-created event into display state", () => {
    const newAgent = agent("agent-b");
    const nextThread = thread("thread-b", true, newAgent);
    const incoming = sessionFromEvent(
      event("session.thread.created", {
        workspace,
        activeAgent: newAgent,
        activeThread: nextThread,
        threads: [nextThread],
      }),
    );

    expect(incoming?.connection).toBeUndefined();

    const merged = mergeSession(session(), incoming!);

    expect(merged.activeThread?.threadId).toBe("thread-b");
    expect(merged.threads?.map((item) => item.threadId)).toEqual(["thread-b", "thread-a"]);
    expect(
      sessionEventRequiresConnectionRefresh(
        event("session.thread.created", { activeThread: nextThread }),
        merged,
        { threadId: "thread-a", agentId: "agent-a", workspaceId: workspace.id },
      ),
    ).toBe(true);
  });

  it("marks thread activation events as requiring connection reconciliation", () => {
    const nextThread = thread("thread-b", true, agent("agent-b"));
    const merged = mergeSession(
      session({ threads: [thread("thread-a", false), nextThread] }),
      sessionFromEvent(
        event("session.thread.activated", {
          workspace,
          activeAgent: nextThread.agent,
          activeThread: nextThread,
          threads: [nextThread],
        }),
      )!,
    );

    expect(
      sessionEventRequiresConnectionRefresh(
        event("session.thread.activated", { activeThread: nextThread }),
        merged,
        { threadId: "thread-a", agentId: "agent-a", workspaceId: workspace.id },
      ),
    ).toBe(true);
  });

  it("identifies stale session events", () => {
    expect(
      shouldIgnoreSessionEvent(session({ revision: 5 }), event("session.snapshot", {}, 4)),
    ).toBe(true);
  });

  it("removes a failed pending new-chat row", () => {
    const withPending = createPendingThreadOptimistically(
      session(),
      () => "fixed-id",
      () => "2026-06-13T00:00:00.000Z",
    );

    expect(withPending?.activeThread?.threadId).toBe("pending-thread-fixed-id");

    const cleaned = removePendingThreads(withPending);

    expect(cleaned?.activeThread?.threadId).toBe("thread-a");
    expect(cleaned?.threads?.map((item) => item.threadId)).toEqual(["thread-a"]);
  });

  it("updates run status only for the matching thread", () => {
    const next = updateThreadStatusFromEvent(
      session({
        threads: [thread("thread-a", true), thread("thread-b")],
      }),
      event("chat.run.started", { threadId: "thread-b" }),
      () => "2026-06-13T00:00:00.000Z",
    );

    expect(next?.threads?.find((item) => item.threadId === "thread-a")?.latestRunStatus).toBe(
      undefined,
    );
    expect(next?.threads?.find((item) => item.threadId === "thread-b")?.latestRunStatus).toBe(
      "running",
    );
  });

  it("optimistically activates a cached thread", () => {
    const next = activateThreadOptimistically(
      session({ threads: [thread("thread-a", true), thread("thread-b")] }),
      "thread-b",
    );

    expect(next?.activeThread?.threadId).toBe("thread-b");
    expect(next?.pending).toEqual({ type: "activate", threadId: "thread-b" });
  });
});
