import { describe, expect, it } from "vitest";

import { evaluateChatRunPolicy, runningChatRunPolicy } from "./chat-policy";
import type { ChatRunRow } from "./types";

describe("chat policy", () => {
  it("uses the same retryable 409 decision for observed and lost running claims", () => {
    const expected = runningChatRunPolicy("ask");
    const observed = evaluateChatRunPolicy({
      executionMode: "ask",
      runningRun: { id: "run-1" } as ChatRunRow,
    });

    expect(observed).toEqual(expected);
    expect(expected).toMatchObject({
      decision: "block",
      status: 409,
      errorCode: "already_running",
      retryable: true,
    });
  });
});
