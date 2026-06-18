import { describe, expect, it } from "vitest";

import { getExternalSignalIdentityHeaders } from "./external-signal-identity";

describe("external signal trigger identity", () => {
  it("builds server-owned account identity without workspace or agent scope", () => {
    const headers = getExternalSignalIdentityHeaders({
      EXTERNAL_SIGNAL_USER_ID: "trigger-user",
      EXTERNAL_SIGNAL_ACCOUNT_ID: "acct-1",
      EXTERNAL_SIGNAL_ACCOUNT_SOURCE: "workos-personal",
      EXTERNAL_SIGNAL_USER_EMAIL: "trigger@example.com",
      EXTERNAL_SIGNAL_MEMBERSHIP_ROLE: "owner",
      EXTERNAL_SIGNAL_WORKSPACE_NAME: "Automation",
    });

    expect(headers).toMatchObject({
      "x-assistant-mk1-user-id": "trigger-user",
      "x-assistant-mk1-account-id": "acct-1",
      "x-assistant-mk1-account-source": "workos-personal",
      "x-assistant-mk1-user-email": "trigger@example.com",
      "x-assistant-mk1-membership-role": "owner",
      "x-assistant-mk1-workspace-name": "Automation",
    });
    expect(headers).not.toHaveProperty("x-assistant-mk1-workspace-id");
    expect(headers).not.toHaveProperty("x-assistant-mk1-agent-id");
  });

  it("requires the trusted trigger principal and account", () => {
    expect(() =>
      getExternalSignalIdentityHeaders({
        EXTERNAL_SIGNAL_USER_ID: "trigger-user",
        EXTERNAL_SIGNAL_ACCOUNT_SOURCE: "workos-personal",
      }),
    ).toThrow("EXTERNAL_SIGNAL_ACCOUNT_ID is required");
  });
});
