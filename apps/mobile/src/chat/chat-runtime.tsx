import {
  AssistantRuntimeProvider,
  type ChatModelAdapter,
  useLocalRuntime,
} from "@assistant-ui/react-native";
import {
  createWorkbenchChatController,
  workbenchChatProtocolVersion,
  type ChatSessionResponse,
  type WorkbenchChatConnectionDescriptor,
  type WorkbenchChatController,
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
import { threadMessagesFromWire } from "./chat-messages";
import { createMobileChatTransport } from "./chat-transport";

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
  const { chatSelectionRevision, client, subscribeSessionEvents } = useWorkbench();
  const controllerRef = useRef<WorkbenchChatController | null>(null);
  const transportUnsubscribeRef = useRef<(() => void) | null>(null);
  const sessionUnsubscribeRef = useRef<(() => void) | null>(null);
  const activeThreadRef = useRef<string | null>(null);
  const runningRef = useRef(false);
  const runtimeRef = useRef<ReturnType<typeof useLocalRuntime> | null>(null);
  const lastTranscriptRef = useRef<readonly Record<string, unknown>[]>([]);
  const [threadId, setThreadId] = useState("new-chat");

  const closeController = useCallback(() => {
    transportUnsubscribeRef.current?.();
    transportUnsubscribeRef.current = null;
    sessionUnsubscribeRef.current?.();
    sessionUnsubscribeRef.current = null;
    controllerRef.current?.close();
    controllerRef.current = null;
  }, []);

  const connectCurrentThread = useCallback(
    async (force = false, resumeQueued = true) => {
      const session = await client.session.get({ source: "mobile-chat-connect" });
      const connection = requireChatConnection(session.connection);
      const nextThreadId = connection.threadId ?? connection.instanceName!;
      if (!force && controllerRef.current && activeThreadRef.current === nextThreadId) {
        await controllerRef.current.connect();
        return controllerRef.current;
      }
      closeController();
      if (activeThreadRef.current !== nextThreadId) runtimeRef.current?.thread.reset([]);
      activeThreadRef.current = nextThreadId;
      setThreadId(nextThreadId);
      lastTranscriptRef.current = [];
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
      const controller = createWorkbenchChatController({
        transport,
        pendingTurns: {
          get: () => mobileStore.getPendingTurn(),
          put: (turn) => mobileStore.putPendingTurn(turn),
          clear: (clientTurnId) => mobileStore.clearPendingTurn(clientTurnId),
        },
      });
      controllerRef.current = controller;
      transportUnsubscribeRef.current = transport.subscribe((event) => {
        if (event.type !== "transcript") return;
        lastTranscriptRef.current = event.messages;
        if (!runningRef.current)
          runtimeRef.current?.thread.reset(threadMessagesFromWire(event.messages));
      });
      sessionUnsubscribeRef.current = subscribeSessionEvents((event) => {
        const eventThreadId = typeof event.data.threadId === "string" ? event.data.threadId : null;
        if (eventThreadId && eventThreadId !== activeThreadRef.current) return;
        controller.acceptSessionEvent(event);
      });
      await controller.connect();
      const queued = resumeQueued ? await mobileStore.getPendingTurn() : null;
      if (queued) {
        runningRef.current = true;
        void controller
          .submit({
            clientTurnId: queued.clientTurnId,
            text: queued.text,
          })
          .catch(() => undefined)
          .finally(() => {
            runningRef.current = false;
            runtimeRef.current?.thread.reset(threadMessagesFromWire(lastTranscriptRef.current));
          });
      }
      return controller;
    },
    [client, closeController, subscribeSessionEvents],
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void controllerRef.current?.resume().catch(() => undefined);
      else controllerRef.current?.pause();
    });
    return () => {
      subscription.remove();
      closeController();
    };
  }, [closeController]);

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
        runningRef.current = true;
        try {
          const controller = await connectCurrentThread(false, false);
          const result = await controller.submit({
            clientTurnId: turn.clientTurnId,
            text: turn.text,
            signal: options.abortSignal,
          });
          return { content: [{ type: "text", text: result.assistantText }] };
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
