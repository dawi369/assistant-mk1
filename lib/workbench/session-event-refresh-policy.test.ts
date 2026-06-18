import { describe, expect, it } from "vitest";

import { sessionEventShouldRefreshAdminSummary } from "./session-event-refresh-policy";

describe("session event Admin summary refresh policy", () => {
  it("refreshes for Cloudflare-owned Admin and workflow visibility events", () => {
    expect(sessionEventShouldRefreshAdminSummary("admin.summary.invalidated")).toBe(true);
    expect(sessionEventShouldRefreshAdminSummary("approval.updated")).toBe(true);
    expect(sessionEventShouldRefreshAdminSummary("workflow.run.updated")).toBe(true);
    expect(sessionEventShouldRefreshAdminSummary("tool.run.updated")).toBe(true);
  });

  it("does not refresh directly for chat lifecycle or trace-only events", () => {
    expect(sessionEventShouldRefreshAdminSummary("chat.run.completed")).toBe(false);
    expect(sessionEventShouldRefreshAdminSummary("chat.run.failed")).toBe(false);
    expect(sessionEventShouldRefreshAdminSummary("trace.updated")).toBe(false);
  });
});
