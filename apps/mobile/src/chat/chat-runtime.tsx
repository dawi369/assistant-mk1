import {
  AssistantRuntimeProvider,
  type ChatModelAdapter,
  useLocalRuntime,
} from "@assistant-ui/react-native";
import {
  workbenchChatProtocolVersion,
  type ChatSessionResponse,
  type WorkbenchChatConnectionDescriptor,
} from "@assistant-mk1/workbench-client";
import * as Crypto from "expo-crypto";
import { AppState } from "react-native";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";

import { mobileStore } from "../storage/mobile-store";
import { useWorkbench } from "../workbench-provider";
import { messagesFromChatEvent } from "./chat-messages";
import { createMobileChatTransport } from "./chat-transport";

type ChatMessage = { id?: unknown; role?: unknown; parts?: unknown };

const textFromMessage = (message: ChatMessage) => {
  if (!Array.isArray(message.parts)) return "";
  return message.parts
    .map((part) =>
      part && typeof part === "object" && "text" in part && typeof part.text === "string"
        ? part.text
        : "",
    )
    .join("")
    .trim();
};

const latestAssistant = (event: Record<string, unknown>) => {
  if (event.type !== "cf_agent_chat_messages" || !Array.isArray(event.messages)) return null;
  const message = [...event.messages]
    .reverse()
    .find((candidate): candidate is ChatMessage =>
      Boolean(candidate && typeof candidate === "object" && candidate.role === "assistant"),
    );
  if (!message || typeof message.id !== "string") return null;
  const text = textFromMessage(message);
  return text ? { id: message.id, text } : null;
};

const latestUserText = (messages: Parameters<ChatModelAdapter["run"]>[0]["messages"]) => {
  const message = [...messages].reverse().find((candidate) => candidate.role === "user");
  if (!message) return "";
  return message.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();
};

const requireChatConnection = (
  connection: ChatSessionResponse["connection"],
): WorkbenchChatConnectionDescriptor => {
  if (
    !connection ||
    connection.chatProtocolVersion !== workbenchChatProtocolVersion ||
    !connection.agentHost ||
    !connection.instanceName ||
    !connection.token
  ) {
    throw new Error("The server does not support this mobile chat protocol.");
  }
  return connection as WorkbenchChatConnectionDescriptor;
};

const MobileChatContext = createContext<{ threadId: string }>({ threadId: "new-chat" });

export const useMobileChat = () => useContext(MobileChatContext);

export function MobileChatRuntimeProvider({ children }: PropsWithChildren) {
  const { chatSelectionRevision, client } = useWorkbench();
  const transportRef = useRef<ReturnType<typeof createMobileChatTransport> | null>(null);
  const transportUnsubscribeRef = useRef<(() => void) | null>(null);
  const activeThreadRef = useRef<string | null>(null);
  const runningRef = useRef(false);
  const runtimeRef = useRef<ReturnType<typeof useLocalRuntime> | null>(null);
  const [threadId, setThreadId] = useState("new-chat");

  const closeTransport = useCallback(() => {
    transportUnsubscribeRef.current?.();
    transportUnsubscribeRef.current = null;
    transportRef.current?.close();
    transportRef.current = null;
  }, []);

  const connectCurrentThread = useCallback(
    async (force = false, resumeQueued = true) => {
      const session = await client.session.get({ source: "mobile-chat-connect" });
      const connection = requireChatConnection(session.connection);
      const nextThreadId = connection.threadId ?? connection.instanceName!;
      if (!force && transportRef.current && activeThreadRef.current === nextThreadId) {
        await transportRef.current.connect();
        return transportRef.current;
      }
      closeTransport();
      if (activeThreadRef.current !== nextThreadId) runtimeRef.current?.thread.reset([]);
      activeThreadRef.current = nextThreadId;
      setThreadId(nextThreadId);
      const transport = createMobileChatTransport({
        getConnection: async () => {
          const fresh = await client.session.get({ source: "mobile-chat-transport" });
          return requireChatConnection(fresh.connection);
        },
        sendTurn: async (pending) => {
          const response = await client.session.materializeTurn({
            text: pending.text,
            clientTurnId: pending.clientTurnId,
            clientWarmSession: true,
          });
          const materialized = response.materializedTurn;
          if (!materialized?.messageId) throw new Error("Chat did not accept the message.");
          return { messageId: materialized.messageId };
        },
      });
      transportRef.current = transport;
      transportUnsubscribeRef.current = transport.subscribe((event) => {
        if (event.type !== "message" || runningRef.current) return;
        const messages = messagesFromChatEvent(event.message);
        if (messages) runtimeRef.current?.thread.reset(messages);
      });
      await transport.connect();
      const queued = resumeQueued ? await mobileStore.getPendingTurn() : null;
      if (queued) {
        await transport.send(queued);
        await mobileStore.clearPendingTurn(queued.clientTurnId);
      }
      return transport;
    },
    [client, closeTransport],
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void transportRef.current?.resume().catch(() => undefined);
      else transportRef.current?.close();
    });
    return () => {
      subscription.remove();
      closeTransport();
    };
  }, [closeTransport]);

  const adapter = useMemo<ChatModelAdapter>(
    () => ({
      async run(options) {
        const text = latestUserText(options.messages);
        if (!text) return { content: [] };
        const queued = await mobileStore.getPendingTurn();
        const turn = queued ?? {
          clientTurnId: `mobile-turn-${Crypto.randomUUID()}`,
          text,
          createdAt: new Date().toISOString(),
        };
        if (queued && queued.text !== text) {
          throw new Error("One message is already waiting to send.");
        }
        await mobileStore.putPendingTurn(turn);
        runningRef.current = true;
        const transport = await connectCurrentThread(false, false);

        const assistantText = new Promise<string>((resolve, reject) => {
          let previousAssistantId: string | null = null;
          let accepted = false;
          const timeout = setTimeout(() => {
            unsubscribe();
            reject(new Error("The response is still running. Reopen this chat to continue."));
          }, 180_000);
          const fail = (error: unknown) => {
            clearTimeout(timeout);
            unsubscribe();
            reject(error);
          };
          const unsubscribe = transport.subscribe((event) => {
            if (event.type === "error") fail(new Error(event.message));
            if (event.type !== "message") return;
            const assistant = latestAssistant(event.message);
            if (!assistant) return;
            if (!accepted) previousAssistantId = assistant.id;
            else if (assistant.id !== previousAssistantId) {
              clearTimeout(timeout);
              unsubscribe();
              resolve(assistant.text);
            }
          });
          options.abortSignal.addEventListener(
            "abort",
            () => {
              clearTimeout(timeout);
              void transport.cancel();
              unsubscribe();
              reject(options.abortSignal.reason);
            },
            { once: true },
          );
          void transport
            .connect()
            .then(() => transport.send({ clientTurnId: turn.clientTurnId, text: turn.text }))
            .then(async () => {
              accepted = true;
              await mobileStore.clearPendingTurn(turn.clientTurnId);
            })
            .catch((error: unknown) => {
              fail(error);
            });
        });
        try {
          return { content: [{ type: "text", text: await assistantText }] };
        } finally {
          runningRef.current = false;
        }
      },
    }),
    [connectCurrentThread],
  );
  const runtime = useLocalRuntime(adapter);
  runtimeRef.current = runtime;

  useEffect(() => {
    void connectCurrentThread(true).catch(() => undefined);
  }, [chatSelectionRevision, connectCurrentThread]);

  return (
    <MobileChatContext.Provider value={{ threadId }}>
      <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>
    </MobileChatContext.Provider>
  );
}
