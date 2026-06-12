import type { ChatSessionResponse } from "@/lib/workbench/workbench-types";

export type WorkbenchAgentConnection = NonNullable<ChatSessionResponse["connection"]> & {
  expiresAt?: string;
};

export const workbenchAgentNewChatEvent = "workbench:agent-new-chat";
export const workbenchAgentSelectThreadEvent = "workbench:agent-select-thread";

export const requestWorkbenchAgentNewChat = () => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(workbenchAgentNewChatEvent));
};

export const requestWorkbenchAgentThread = (threadId: string) => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<{ threadId: string }>(workbenchAgentSelectThreadEvent, {
      detail: { threadId },
    }),
  );
};
