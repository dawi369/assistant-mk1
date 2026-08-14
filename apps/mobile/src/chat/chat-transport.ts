import type {
  WorkbenchChatConnectionDescriptor,
  WorkbenchChatEvent,
  WorkbenchChatTransport,
} from "@assistant-mk1/workbench-client";
import { AgentClient } from "agents/client";

type SendTurn = (input: { clientTurnId: string; text: string }) => Promise<{ messageId: string }>;

const hostOptions = (agentHost: string) => {
  const url = new URL(agentHost);
  return {
    host: url.host,
    protocol: url.protocol === "http:" ? ("ws" as const) : ("wss" as const),
  };
};

export const createMobileChatTransport = (input: {
  getConnection: () => Promise<WorkbenchChatConnectionDescriptor>;
  sendTurn: SendTurn;
}): WorkbenchChatTransport => {
  const listeners = new Set<(event: WorkbenchChatEvent) => void>();
  let agent: AgentClient | null = null;
  let activeRequestId: string | null = null;
  const emit = (event: WorkbenchChatEvent) => listeners.forEach((listener) => listener(event));

  const connect = async () => {
    if (agent) return;
    emit({ type: "connection", state: "connecting" });
    const connection = await input.getConnection();
    const host = hostOptions(connection.agentHost!);
    const next = new AgentClient({
      agent: "WorkbenchThreadChatAgent",
      name: connection.instanceName!,
      host: host.host,
      protocol: host.protocol,
      query: { token: connection.token! },
    });
    next.addEventListener("open", () => emit({ type: "connection", state: "connected" }));
    next.addEventListener("close", () => emit({ type: "connection", state: "disconnected" }));
    next.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(String(event.data)) as Record<string, unknown>;
        if (message.type === "cf_agent_use_chat_response" && typeof message.id === "string") {
          activeRequestId = message.id;
        }
        if (message.type === "cf_agent_chat_messages" && Array.isArray(message.messages)) {
          emit({
            type: "transcript",
            messages: message.messages.filter((candidate): candidate is Record<string, unknown> =>
              Boolean(candidate && typeof candidate === "object" && !Array.isArray(candidate)),
            ),
          });
        }
      } catch {
        emit({
          type: "error",
          code: "invalid_chat_event",
          message: "The chat service returned an unreadable event.",
          recoverable: true,
        });
      }
    });
    agent = next;
    await next.ready;
  };

  return {
    connect,
    async send(turn) {
      await connect();
      return input.sendTurn(turn);
    },
    async cancel() {
      if (agent && activeRequestId) {
        agent.send(JSON.stringify({ id: activeRequestId, type: "cf_agent_chat_request_cancel" }));
      }
    },
    async resume() {
      agent?.close(1000, "foreground-resume");
      agent = null;
      await connect();
    },
    close() {
      agent?.close(1000, "client-close");
      agent = null;
      emit({ type: "connection", state: "disconnected" });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};
