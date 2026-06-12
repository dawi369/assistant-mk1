"use client";

import { useAuiEvent } from "@assistant-ui/react";

import { requestWorkbenchSummaryRefresh } from "@/lib/workbench/admin-summary-events";
import { useWorkbenchAgentConnection } from "@/lib/workbench/use-agent-connection";

export function WorkbenchAssistantEvents() {
  const { refresh } = useWorkbenchAgentConnection();

  useAuiEvent("thread.initialize", () => requestWorkbenchSummaryRefresh());
  useAuiEvent("thread.runStart", () => requestWorkbenchSummaryRefresh());
  useAuiEvent("thread.runEnd", () => {
    requestWorkbenchSummaryRefresh();
    void refresh();
  });
  useAuiEvent("composer.send", () => requestWorkbenchSummaryRefresh());
  useAuiEvent("threadListItem.switchedTo", () => requestWorkbenchSummaryRefresh());

  return null;
}
