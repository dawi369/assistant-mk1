import { describe, expect, it } from "vitest";

import { adminSummaryProjectionPath, readAdminSummaryProjection } from "./admin-summary-projection";

describe("admin summary projection", () => {
  it("defaults direct callers to drawer projection", () => {
    expect(readAdminSummaryProjection(null)).toBe("drawer");
    expect(readAdminSummaryProjection("unknown")).toBe("drawer");
  });

  it("accepts compact and drawer projections", () => {
    expect(readAdminSummaryProjection("compact")).toBe("compact");
    expect(readAdminSummaryProjection("drawer")).toBe("drawer");
  });

  it("builds the signed Cloudflare path with query parameters", () => {
    expect(adminSummaryProjectionPath()).toBe("/admin/workspace-summary");
    expect(adminSummaryProjectionPath("compact")).toBe(
      "/admin/workspace-summary?projection=compact",
    );
  });
});
