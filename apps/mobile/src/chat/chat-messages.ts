import type { ThreadMessageLike } from "@assistant-ui/react-native";

type WireMessage = { id?: unknown; role?: unknown; parts?: unknown };

const textPart = (part: unknown) => {
  if (!part || typeof part !== "object" || !("type" in part)) return null;
  if (
    (part.type === "text" || part.type === "reasoning") &&
    "text" in part &&
    typeof part.text === "string"
  ) {
    return { type: part.type, text: part.text } as const;
  }
  return null;
};

export const threadMessagesFromWire = (messages: readonly unknown[]): ThreadMessageLike[] =>
  messages.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const message = candidate as WireMessage;
    if (message.role !== "assistant" && message.role !== "user" && message.role !== "system") {
      return [];
    }
    const content = Array.isArray(message.parts)
      ? message.parts.map(textPart).filter((part) => part !== null)
      : [];
    return [
      {
        id: typeof message.id === "string" ? message.id : undefined,
        role: message.role,
        content,
      },
    ];
  });

export const messagesFromChatEvent = (event: Record<string, unknown>) =>
  event.type === "cf_agent_chat_messages" && Array.isArray(event.messages)
    ? threadMessagesFromWire(event.messages)
    : null;
