import type { ChatSessionResponse, Id } from "./contracts/index.js";

export const workbenchChatProtocolVersion = 1 as const;

export type WorkbenchChatConnectionDescriptor = NonNullable<ChatSessionResponse["connection"]> & {
  chatProtocolVersion: typeof workbenchChatProtocolVersion;
};

export type WorkbenchChatEvent =
  | { type: "connection"; state: "connecting" | "connected" | "disconnected" }
  | { type: "message"; message: Record<string, unknown> }
  | { type: "error"; code: string; message: string; recoverable: boolean }
  | { type: "replaced"; reason: "agent_handoff" | "token_refresh" };

export type WorkbenchChatTransport = {
  connect(): Promise<void>;
  send(input: { clientTurnId: Id; text: string }): Promise<{ messageId: Id }>;
  cancel(): Promise<void>;
  resume(): Promise<void>;
  close(): void;
  subscribe(listener: (event: WorkbenchChatEvent) => void): () => void;
};
