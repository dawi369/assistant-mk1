"use client";

import { useAuiEvent } from "@assistant-ui/react";

import { requestWorkbenchSummaryRefresh } from "@/lib/workbench/admin-summary-events";

export function WorkbenchAssistantEvents() {
  useAuiEvent("thread.initialize", () => requestWorkbenchSummaryRefresh());
  useAuiEvent("thread.runStart", () => requestWorkbenchSummaryRefresh());
  useAuiEvent("thread.runEnd", () => requestWorkbenchSummaryRefresh());
  useAuiEvent("composer.send", () => requestWorkbenchSummaryRefresh());
  useAuiEvent("threadListItem.switchedTo", () => requestWorkbenchSummaryRefresh());

  return null;
}
