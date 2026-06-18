"use client";

import { useAuiEvent } from "@assistant-ui/react";

import { useWorkbenchAgentConnection } from "@/lib/workbench/use-agent-connection";

export function WorkbenchAssistantEvents() {
  const { refresh } = useWorkbenchAgentConnection();

  useAuiEvent("thread.runEnd", () => {
    void refresh();
  });

  return null;
}
