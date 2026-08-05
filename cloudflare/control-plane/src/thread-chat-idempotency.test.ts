import { describe, expect, it } from "vitest";

import { existingProgrammaticTurnMessageId } from "./thread-chat-idempotency";

describe("programmatic chat turn identity", () => {
  it("returns the original durable user message for duplicate client turn ids", () => {
    expect(
      existingProgrammaticTurnMessageId(
        [
          { id: "turn-1", role: "user" },
          { id: "assistant-1", role: "assistant" },
        ],
        "turn-1",
      ),
    ).toBe("turn-1");
  });

  it("does not conflate assistant ids or distinct user turns", () => {
    expect(
      existingProgrammaticTurnMessageId([{ id: "turn-1", role: "assistant" }], "turn-1"),
    ).toBeUndefined();
    expect(
      existingProgrammaticTurnMessageId([{ id: "turn-2", role: "user" }], "turn-1"),
    ).toBeUndefined();
  });
});
