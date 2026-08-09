import { describe, expect, it } from "vitest";

import { messagesFromChatEvent, threadMessagesFromWire } from "./chat-messages";

describe("mobile chat transcript conversion", () => {
  it("preserves stable message identity and supported display parts", () => {
    expect(
      threadMessagesFromWire([
        { id: "user-1", role: "user", parts: [{ type: "text", text: "hello" }] },
        {
          id: "assistant-1",
          role: "assistant",
          parts: [
            { type: "reasoning", text: "checking" },
            { type: "text", text: "done" },
          ],
        },
      ]),
    ).toEqual([
      { id: "user-1", role: "user", content: [{ type: "text", text: "hello" }] },
      {
        id: "assistant-1",
        role: "assistant",
        content: [
          { type: "reasoning", text: "checking" },
          { type: "text", text: "done" },
        ],
      },
    ]);
  });

  it("rejects unrelated events and unsupported message roles", () => {
    expect(messagesFromChatEvent({ type: "other", messages: [] })).toBeNull();
    expect(
      messagesFromChatEvent({
        type: "cf_agent_chat_messages",
        messages: [{ id: "tool-1", role: "tool", parts: [] }, null],
      }),
    ).toEqual([]);
  });
});
