import type { WorkbenchSessionEvent } from "./workbench-types";

const adminSummaryRefreshEventTypes = new Set<WorkbenchSessionEvent["type"]>([
  "admin.summary.invalidated",
  "approval.updated",
  "workflow.run.updated",
  "tool.run.updated",
]);

export const sessionEventShouldRefreshAdminSummary = (eventType: WorkbenchSessionEvent["type"]) =>
  adminSummaryRefreshEventTypes.has(eventType);
