import { describe, expect, it } from "vitest";

import {
  signAgentConnectionClaims,
  verifyAgentConnectionToken,
  type AgentConnectionClaims,
} from "./agent-connection-token";

const futureExp = () => Math.floor(Date.now() / 1000) + 600;

const claims = (input: Partial<AgentConnectionClaims> = {}): AgentConnectionClaims => ({
  v: 1,
  exp: futureExp(),
  nonce: "nonce-a",
  userId: "user-a",
  workspaceId: "workspace-a",
  agentId: "agent-a",
  threadId: "thread-a",
  sessionId: "session-a",
  instanceName: "thread-instance-a",
  runtime: "cloudflare-agent-chat",
  ...input,
});

describe("agent connection token", () => {
  it("round-trips selected agent and preserved thread instance claims", async () => {
    const token = await signAgentConnectionClaims(
      "test-secret",
      claims({ agentId: "agent-b", instanceName: "legacy-thread-instance" }),
    );

    await expect(verifyAgentConnectionToken("test-secret", token)).resolves.toMatchObject({
      agentId: "agent-b",
      instanceName: "legacy-thread-instance",
      threadId: "thread-a",
      workspaceId: "workspace-a",
    });
  });

  it("rejects tokens signed with a different secret", async () => {
    const token = await signAgentConnectionClaims("test-secret", claims());

    await expect(verifyAgentConnectionToken("other-secret", token)).rejects.toThrow(
      "Invalid agent token signature",
    );
  });
});
