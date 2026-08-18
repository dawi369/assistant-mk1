import type {
  WorkbenchChatConnectionDescriptor,
  WorkbenchChatEvent,
  WorkbenchChatTransport,
} from "@assistant-mk1/workbench-client";
import { AgentClient } from "agents/client";

type SendTurn = (input: { clientTurnId: string; text: string }) => Promise<{ messageId: string }>;
type AgentClientOptions = ConstructorParameters<typeof AgentClient>[0];
type CreateAgentClient = (options: AgentClientOptions) => AgentClient;

const defaultConnectionTimeoutMs = 10_000;

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
  createAgentClient?: CreateAgentClient;
  connectionTimeoutMs?: number;
}): WorkbenchChatTransport => {
  const listeners = new Set<(event: WorkbenchChatEvent) => void>();
  let agent: AgentClient | null = null;
  let connectionAttempt: Promise<void> | null = null;
  let cancelConnectionAttempt: (() => void) | null = null;
  let connectionTimeout: ReturnType<typeof setTimeout> | null = null;
  let connectionGeneration = 0;
  let activeRequestId: string | null = null;
  const emit = (event: WorkbenchChatEvent) => listeners.forEach((listener) => listener(event));
  const createAgentClient = input.createAgentClient ?? ((options) => new AgentClient(options));

  const closeAgent = (reason: string) => {
    connectionGeneration += 1;
    connectionAttempt = null;
    const cancelAttempt = cancelConnectionAttempt;
    cancelConnectionAttempt = null;
    if (connectionTimeout) clearTimeout(connectionTimeout);
    connectionTimeout = null;
    cancelAttempt?.();
    activeRequestId = null;
    const current = agent;
    agent = null;
    current?.close(1000, reason);
  };

  const connect = async () => {
    if (connectionAttempt) return connectionAttempt;
    if (agent?.identified) return;
    const generation = ++connectionGeneration;
    emit({ type: "connection", state: "connecting" });
    const attempt = (async () => {
      const connection = await input.getConnection();
      if (generation !== connectionGeneration) return;
      const host = hostOptions(connection.agentHost!);
      const next = createAgentClient({
        agent: "WorkbenchThreadChatAgent",
        name: connection.instanceName!,
        host: host.host,
        protocol: host.protocol,
        query: { token: connection.token! },
      });
      agent = next;
      next.addEventListener("close", () => {
        if (agent === next) emit({ type: "connection", state: "disconnected" });
      });
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
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      let cancelAttempt: (() => void) | null = null;
      const connectionBoundary = new Promise<never>((_, reject) => {
        cancelAttempt = () => reject(new Error("Live chat connection was replaced."));
        cancelConnectionAttempt = cancelAttempt;
        timeoutId = setTimeout(() => {
          reject(new Error("Live updates timed out. Message delivery remains available."));
        }, input.connectionTimeoutMs ?? defaultConnectionTimeoutMs);
      });
      connectionTimeout = timeoutId;
      try {
        await Promise.race([next.ready, connectionBoundary]);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
        if (connectionTimeout === timeoutId) connectionTimeout = null;
        if (cancelConnectionAttempt === cancelAttempt) cancelConnectionAttempt = null;
      }
      if (generation === connectionGeneration) {
        emit({ type: "connection", state: "connected" });
      }
    })()
      .catch((cause: unknown) => {
        if (generation !== connectionGeneration) return;
        closeAgent("connection-failed");
        emit({
          type: "error",
          code: "chat_connection_failed",
          message: cause instanceof Error ? cause.message : "Live chat connection failed.",
          recoverable: true,
        });
        throw cause;
      })
      .finally(() => {
        if (connectionAttempt === attempt) connectionAttempt = null;
      });
    connectionAttempt = attempt;
    return attempt;
  };

  const reconnect = async (reason: string) => {
    closeAgent(reason);
    await connect();
  };

  const observeAcceptedTurn = async () => {
    try {
      await connect();
    } catch {
      // The durable command already succeeded. Refresh authority and retry the
      // disposable observer once without delaying or duplicating the command.
      await connect();
    }
  };

  return {
    connect,
    async send(turn) {
      // HTTP command acceptance is the source of truth and cannot depend on
      // the disposable realtime observer being connected.
      const accepted = await input.sendTurn(turn);
      void observeAcceptedTurn().catch(() => undefined);
      return accepted;
    },
    async cancel() {
      if (agent && activeRequestId) {
        agent.send(JSON.stringify({ id: activeRequestId, type: "cf_agent_chat_request_cancel" }));
      }
    },
    async resume() {
      await reconnect("foreground-resume");
    },
    close() {
      closeAgent("client-close");
      emit({ type: "connection", state: "disconnected" });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};
