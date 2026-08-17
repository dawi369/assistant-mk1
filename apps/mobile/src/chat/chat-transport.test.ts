import type {
  WorkbenchChatConnectionDescriptor,
  WorkbenchChatEvent,
} from "@assistant-mk1/workbench-client";
import { describe, expect, it, vi } from "vitest";

import { createMobileChatTransport } from "./chat-transport";

const connection = (token: string): WorkbenchChatConnectionDescriptor => ({
  agentHost: "https://control.example.test",
  chatProtocolVersion: 2,
  instanceName: "thread-1",
  threadId: "thread-1",
  token,
});

const socket = () => {
  const listeners = new Map<string, Set<(event: { data?: unknown }) => void>>();
  return {
    identified: false,
    ready: new Promise<void>(() => undefined),
    addEventListener: vi.fn((type: string, listener: (event: { data?: unknown }) => void) => {
      const current = listeners.get(type) ?? new Set();
      current.add(listener);
      listeners.set(type, current);
    }),
    close: vi.fn(),
    send: vi.fn(),
  };
};

describe("mobile chat transport", () => {
  it("accepts a turn before the realtime Agent socket identifies", async () => {
    const observer = socket();
    const sendTurn = vi.fn(async ({ clientTurnId }: { clientTurnId: string }) => ({
      messageId: clientTurnId,
    }));
    const createAgentClient = vi.fn(() => observer);
    const transport = createMobileChatTransport({
      getConnection: vi.fn(async () => connection("fresh-token")),
      sendTurn,
      createAgentClient: createAgentClient as never,
    });

    await expect(transport.send({ clientTurnId: "turn-1", text: "hello" })).resolves.toEqual({
      messageId: "turn-1",
    });
    expect(sendTurn).toHaveBeenCalledWith({ clientTurnId: "turn-1", text: "hello" });
    await vi.waitFor(() => expect(createAgentClient).toHaveBeenCalledOnce());

    transport.close();
  });

  it("refreshes realtime authority after acceptance and reports bounded connection failure", async () => {
    const first = socket();
    const second = socket();
    const createAgentClient = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const events: WorkbenchChatEvent[] = [];
    const transport = createMobileChatTransport({
      getConnection: vi
        .fn()
        .mockResolvedValueOnce(connection("initial-token"))
        .mockResolvedValueOnce(connection("fresh-token")),
      sendTurn: vi.fn(async () => ({ messageId: "turn-2" })),
      createAgentClient: createAgentClient as never,
      connectionTimeoutMs: 200,
    });
    transport.subscribe((event) => events.push(event));

    const initialConnection = transport.connect();
    await vi.waitFor(() => expect(createAgentClient).toHaveBeenCalledTimes(1));
    await transport.send({ clientTurnId: "turn-2", text: "hello again" });
    await expect(initialConnection).resolves.toBeUndefined();
    await vi.waitFor(() => expect(createAgentClient).toHaveBeenCalledTimes(2));
    expect(first.close).toHaveBeenCalledWith(1000, "turn-accepted");
    await vi.waitFor(() =>
      expect(events).toContainEqual(
        expect.objectContaining({ type: "error", code: "chat_connection_failed" }),
      ),
    );

    transport.close();
  });
});
