import type { ThreadMessageLike } from "@assistant-ui/react-native";

type WireMessage = { id?: unknown; role?: unknown; parts?: unknown };

const textPart = (part: unknown) => {
  if (!part || typeof part !== "object" || !("type" in part)) return null;
  if (
    (part.type === "text" || part.type === "reasoning") &&
    "text" in part &&
    typeof part.text === "string"
  ) {
    const text = part.text.trim();
    return text ? ({ type: part.type, text } as const) : null;
  }
  return null;
};

const toolPart = (part: unknown) => {
  if (!part || typeof part !== "object" || !("type" in part) || typeof part.type !== "string") {
    return null;
  }
  if (part.type !== "dynamic-tool" && !part.type.startsWith("tool-")) return null;
  const toolName =
    part.type === "dynamic-tool" && "toolName" in part && typeof part.toolName === "string"
      ? part.toolName
      : part.type.slice(5);
  if (!toolName) return null;
  const input = "input" in part ? part.input : "args" in part ? part.args : undefined;
  const output = "output" in part ? part.output : "result" in part ? part.result : undefined;
  return {
    type: "tool-call" as const,
    toolCallId:
      "toolCallId" in part && typeof part.toolCallId === "string" ? part.toolCallId : undefined,
    toolName,
    args:
      input && typeof input === "object" && !Array.isArray(input)
        ? (input as Record<string, never>)
        : {},
    argsText: JSON.stringify(input ?? {}),
    result: output,
    isError: "state" in part && part.state === "output-error",
  };
};

export const threadMessagesFromWire = (messages: readonly unknown[]): ThreadMessageLike[] =>
  messages.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const message = candidate as WireMessage;
    if (message.role !== "assistant" && message.role !== "user" && message.role !== "system") {
      return [];
    }
    const content = Array.isArray(message.parts)
      ? message.parts
          .map((part) => textPart(part) ?? toolPart(part))
          .filter((part) => part !== null)
      : [];
    return [
      {
        id: typeof message.id === "string" ? message.id : undefined,
        role: message.role,
        content: content as ThreadMessageLike["content"],
      },
    ];
  });

export const messagesFromChatEvent = (event: Record<string, unknown>) =>
  event.type === "cf_agent_chat_messages" && Array.isArray(event.messages)
    ? threadMessagesFromWire(event.messages)
    : null;
