"use client";

import { useAuiEvent } from "@assistant-ui/react";

import { requestWorkbenchSummaryRefresh } from "@/lib/workbench/admin-summary-events";
import { useWorkbenchAgentConnection } from "@/lib/workbench/use-agent-connection";

export function WorkbenchAssistantEvents() {
  const { refresh } = useWorkbenchAgentConnection();

  useAuiEvent("thread.initialize", () => requestWorkbenchSummaryRefresh({ source: "event" }));
  useAuiEvent("thread.runStart", () => requestWorkbenchSummaryRefresh({ source: "event" }));
  useAuiEvent("thread.runEnd", () => {
    requestWorkbenchSummaryRefresh({ source: "event" });
    void refresh();
  });
  useAuiEvent("composer.send", () => requestWorkbenchSummaryRefresh({ source: "event" }));
  useAuiEvent("threadListItem.switchedTo", () =>
    requestWorkbenchSummaryRefresh({ source: "event" }),
  );

  return null;
}
