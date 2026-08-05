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
import { useEffect, useMemo, useRef, type PropsWithChildren } from "react";

import { mobileStore } from "../storage/mobile-store";
import { useWorkbench } from "../workbench-provider";
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

export function MobileChatRuntimeProvider({ children }: PropsWithChildren) {
  const { client } = useWorkbench();
  const transportRef = useRef<ReturnType<typeof createMobileChatTransport> | null>(null);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void transportRef.current?.resume();
      else transportRef.current?.close();
    });
    return () => {
      subscription.remove();
      transportRef.current?.close();
    };
  }, []);

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

        const session = await client.session.get({ source: "mobile-chat-send" });
        const connection = requireChatConnection(session.connection);
        transportRef.current?.close();
        const transport = createMobileChatTransport({
          connection,
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

        const assistantText = new Promise<string>((resolve, reject) => {
          let previousAssistantId: string | null = null;
          let accepted = false;
          const timeout = setTimeout(() => {
            unsubscribe();
            reject(new Error("The response is still running. Reopen this chat to continue."));
          }, 180_000);
          const unsubscribe = transport.subscribe((event) => {
            if (event.type === "error") reject(new Error(event.message));
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
              clearTimeout(timeout);
              unsubscribe();
              reject(error);
            });
        });
        return { content: [{ type: "text", text: await assistantText }] };
      },
    }),
    [client],
  );
  const runtime = useLocalRuntime(adapter);
  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}
