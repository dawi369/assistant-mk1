import { describe, expect, it } from "vitest";

import {
  deriveRuntimeState,
  isAdminSummaryFreshForLiveEvent,
  liveChatStateFromEvent,
} from "./chat-runtime-live-state";
import type {
  ChatRuntimeSummary,
  ChatSessionResponse,
  CloudflareAdminSummaryResponse,
  WorkbenchSessionEvent,
} from "./workbench-types";

const event = (
  type: WorkbenchSessionEvent["type"],
  createdAt = "2026-06-17T12:00:10.000Z",
): WorkbenchSessionEvent => ({
  id: `event-${type}`,
  type,
  revision: 2,
  createdAt,
  data: { threadId: "thread-a" },
});

const session = (threadId = "thread-a"): ChatSessionResponse => ({
  activeThread: {
    threadId,
    sessionId: "session-a",
    agentId: "agent-a",
    status: "active",
    title: "Thread A",
    isActive: true,
  },
});

const chatRuntime = (state: ChatRuntimeSummary["state"]): ChatRuntimeSummary => ({
  state,
  latestSession: null,
  latestThread: null,
  latestRun: null,
  latestIntent: null,
  latestPolicyDecision: null,
  timings: null,
  events: [],
  failure: null,
});

const summary = (
  state: ChatRuntimeSummary["state"],
  generatedAt = "2026-06-17T12:00:11.000Z",
): NonNullable<CloudflareAdminSummaryResponse["summary"]> =>
  ({
    generatedAt,
    activeAgent: null,
    chatRuntime: chatRuntime(state),
    lastError: null,
  }) as NonNullable<CloudflareAdminSummaryResponse["summary"]>;

describe("chat runtime live state", () => {
  it("maps live session chat events to chat runtime states", () => {
    expect(liveChatStateFromEvent(event("chat.run.started"))).toBe("running");
    expect(liveChatStateFromEvent(event("chat.run.completed"))).toBe("completed");
    expect(liveChatStateFromEvent(event("chat.run.failed"))).toBe("failed");
    expect(liveChatStateFromEvent(event("trace.updated"))).toBeUndefined();
  });

  it("uses live session state ahead of stale Admin summary state", () => {
    const state = deriveRuntimeState({
      session: session(),
      connection: null,
      error: null,
      isSessionStreamConnected: true,
      latestSessionEvent: event("chat.run.started", "2026-06-17T12:00:10.000Z"),
      pending: null,
      isInitialLoading: false,
      summary: summary("completed", "2026-06-17T12:00:09.000Z"),
    });

    expect(state.chatState).toBe("running");
    expect(state.chatLabel).toBe("Running");
    expect(state.source).toBe("live_session_event");
    expect(state.summaryIsStale).toBe(true);
  });

  it("uses fresh Admin summary state when no live chat event exists", () => {
    const state = deriveRuntimeState({
      session: null,
      connection: null,
      error: null,
      isSessionStreamConnected: false,
      latestSessionEvent: null,
      pending: null,
      isInitialLoading: false,
      summary: summary("thread_ready"),
    });

    expect(state.chatState).toBe("thread_ready");
    expect(state.chatLabel).toBe("Ready");
    expect(state.source).toBe("summary");
    expect(state.summaryIsFresh).toBe(true);
  });

  it("requires summary generatedAt to be newer than the live event", () => {
    expect(
      isAdminSummaryFreshForLiveEvent(
        summary("completed", "2026-06-17T12:00:09.000Z"),
        event("chat.run.completed", "2026-06-17T12:00:10.000Z"),
      ),
    ).toBe(false);
    expect(
      isAdminSummaryFreshForLiveEvent(
        summary("completed", "2026-06-17T12:00:11.000Z"),
        event("chat.run.completed", "2026-06-17T12:00:10.000Z"),
      ),
    ).toBe(true);
  });

  it("keeps the last known runtime state while non-run details catch up", () => {
    const state = deriveRuntimeState({
      session: null,
      connection: { workspaceId: "workspace-a" },
      error: null,
      isSessionStreamConnected: true,
      latestSessionEvent: event("trace.updated", "2026-06-17T12:00:10.000Z"),
      pending: null,
      isInitialLoading: false,
      summary: summary("completed", "2026-06-17T12:00:09.000Z"),
    });

    expect(state.chatLabel).toBe("Completed");
    expect(state.chatTone).toBe("completed");
    expect(state.cloudflareStatus).toBe("Live");
    expect(state.summaryIsStale).toBe(true);
  });

  it("preserves a newer completed chat event across summary invalidation", () => {
    const state = deriveRuntimeState({
      session: session(),
      connection: { workspaceId: "workspace-a" },
      error: null,
      isSessionStreamConnected: true,
      latestSessionEvent: event("admin.summary.invalidated", "2026-06-17T12:00:11.000Z"),
      latestChatRunEvent: event("chat.run.completed", "2026-06-17T12:00:10.000Z"),
      pending: null,
      isInitialLoading: false,
      summary: summary("running", "2026-06-17T12:00:09.000Z"),
    });

    expect(state.chatState).toBe("completed");
    expect(state.chatLabel).toBe("Completed");
    expect(state.source).toBe("live_session_event");
    expect(state.summaryIsStale).toBe(true);
  });

  it("lets a newer summary supersede the retained chat event", () => {
    const state = deriveRuntimeState({
      session: null,
      connection: { workspaceId: "workspace-a" },
      error: null,
      isSessionStreamConnected: true,
      latestSessionEvent: event("chat.run.completed", "2026-06-17T12:00:10.000Z"),
      latestChatRunEvent: event("chat.run.completed", "2026-06-17T12:00:10.000Z"),
      pending: null,
      isInitialLoading: false,
      summary: summary("thread_ready", "2026-06-17T12:00:11.000Z"),
    });

    expect(state.chatState).toBe("thread_ready");
    expect(state.chatLabel).toBe("Ready");
    expect(state.source).toBe("live_session_stream");
  });

  it("does not carry retained chat state into another active thread", () => {
    const state = deriveRuntimeState({
      session: session("thread-b"),
      connection: { workspaceId: "workspace-a" },
      error: null,
      isSessionStreamConnected: true,
      latestSessionEvent: event("session.thread.activated", "2026-06-17T12:00:11.000Z"),
      latestChatRunEvent: event("chat.run.completed", "2026-06-17T12:00:10.000Z"),
      pending: null,
      isInitialLoading: false,
      summary: summary("thread_ready", "2026-06-17T12:00:09.000Z"),
    });

    expect(state.chatState).toBe("thread_ready");
    expect(state.chatLabel).toBe("Ready");
  });

  it("does not present a historical workflow failure as a live chat failure", () => {
    const historicalFailure = summary("thread_ready");
    historicalFailure.lastError = {
      source: "execution",
      message: "A prior workflow failed.",
      status: "failed",
      targetId: "run-old",
      createdAt: "2026-06-16T12:00:00.000Z",
    };

    const state = deriveRuntimeState({
      session: null,
      connection: { workspaceId: "workspace-a" },
      error: null,
      isSessionStreamConnected: true,
      latestSessionEvent: null,
      pending: null,
      isInitialLoading: false,
      summary: historicalFailure,
    });

    expect(state.errorMessage).toBeUndefined();
    expect(state.cloudflareStatus).toBe("Live");
  });
});
