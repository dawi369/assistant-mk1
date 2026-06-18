import { describe, expect, it, vi } from "vitest";

import { hasModelVisibleToolCandidate } from "./model-tools";
import { urlInspectToolName } from "./tool-policy";
import type { AgentIdentity, Env } from "./types";

const identity = {
  agentId: "agent_1",
  scope: {
    userId: "user_1",
    workspaceId: "workspace_1",
    accountId: "account_1",
    accountSource: "test",
  },
} as AgentIdentity;

const envWithPermission = (permission: { status: string; data_json: string } | null) => {
  const first = vi.fn(() => Promise.resolve(permission));
  const bind = vi.fn(() => ({ first }));
  const prepare = vi.fn(() => ({ bind }));
  return {
    env: { DB: { prepare } } as unknown as Env,
    first,
    bind,
    prepare,
  };
};

describe("model tool exposure fast path", () => {
  it("does not treat a missing default-hidden permission as a model-visible candidate", async () => {
    const { env } = envWithPermission(null);

    await expect(hasModelVisibleToolCandidate(env, identity, urlInspectToolName)).resolves.toBe(
      false,
    );
  });

  it("recognizes an enabled model-visible permission as a candidate", async () => {
    const { env } = envWithPermission({
      status: "enabled",
      data_json: JSON.stringify({ modelVisible: true, requiresApproval: false }),
    });

    await expect(hasModelVisibleToolCandidate(env, identity, urlInspectToolName)).resolves.toBe(
      true,
    );
  });

  it("rejects disabled or approval-gated permissions from the fast path", async () => {
    const disabled = envWithPermission({
      status: "disabled",
      data_json: JSON.stringify({ modelVisible: true, requiresApproval: false }),
    });
    const approvalGated = envWithPermission({
      status: "enabled",
      data_json: JSON.stringify({ modelVisible: true, requiresApproval: true }),
    });

    await expect(
      hasModelVisibleToolCandidate(disabled.env, identity, urlInspectToolName),
    ).resolves.toBe(false);
    await expect(
      hasModelVisibleToolCandidate(approvalGated.env, identity, urlInspectToolName),
    ).resolves.toBe(false);
  });
});
