import { describe, expect, it } from "vitest";

import { toThreadLifecycleControlPlaneEvent } from "./session-lifecycle-events";

describe("session lifecycle control-plane events", () => {
  it("maps lifecycle transitions to compact redacted event metadata", () => {
    const event = toThreadLifecycleControlPlaneEvent({
      transition: "archive",
      threadId: "thread-a",
      activeThreadId: "thread-b",
      replacementThreadId: "thread-b",
      previousStatus: "active",
      nextStatus: "archived",
    });

    expect(event).toEqual({
      type: "session.thread.archived",
      summary: "Archived chat thread.",
      targetType: "thread",
      targetId: "thread-a",
      data: {
        source: "session-coordinator",
        transition: "archive",
        activeThreadId: "thread-b",
        replacementThreadId: "thread-b",
        previousStatus: "active",
        nextStatus: "archived",
      },
    });
    expect(JSON.stringify(event)).not.toMatch(/token|prompt|message|secret/i);
  });

  it("records running-thread blocks without exposing raw run data", () => {
    const event = toThreadLifecycleControlPlaneEvent({
      transition: "blocked",
      threadId: "thread-a",
      previousStatus: "active",
      nextStatus: "archived",
      blockedAction: "archive",
      reasonCode: "running_chat_response",
    });

    expect(event.type).toBe("session.thread.blocked");
    expect(event.targetId).toBe("thread-a");
    expect(event.data).toEqual({
      source: "session-coordinator",
      transition: "blocked",
      previousStatus: "active",
      nextStatus: "archived",
      blockedAction: "archive",
      reasonCode: "running_chat_response",
    });
  });
});
