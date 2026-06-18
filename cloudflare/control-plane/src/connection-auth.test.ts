import { describe, expect, it } from "vitest";

import {
  connectionAuthForTool,
  connectionAuthorizationRequired,
  noConnectionAuthRequired,
} from "./connection-auth";

describe("connection auth brokerage", () => {
  it("marks current tools as not requiring external connection auth", () => {
    expect(connectionAuthForTool("url.inspect")).toEqual({
      required: false,
      status: "not_required",
      principal: "none",
      tokenRefresh: "not_applicable",
      toolFilter: "not_required",
      approvalOrder: "policy_before_connection",
      reason: "url.inspect does not require an external connection.",
    });
    expect(noConnectionAuthRequired("demo.inspect").reason).toContain("demo.inspect");
    expect(connectionAuthForTool("repo.snapshot")).toMatchObject({
      required: false,
      status: "not_required",
      principal: "none",
      tokenRefresh: "not_applicable",
    });
  });

  it("defines the future authorization-required event shape without secrets", () => {
    const auth = connectionAuthorizationRequired({
      toolName: "mail.send",
      principal: "user",
      connectionName: "gmail",
    });

    expect(auth).toEqual({
      required: true,
      status: "authorization_required",
      principal: "user",
      connectionName: "gmail",
      authorizationEventType: "connection.authorization_required",
      tokenRefresh: "brokered",
      toolFilter: "connection_scoped",
      approvalOrder: "connection_before_policy",
      reason: "mail.send requires user authorization for gmail.",
    });
    expect(JSON.stringify(auth)).not.toMatch(/secret|refreshToken|accessToken/i);
  });
});
