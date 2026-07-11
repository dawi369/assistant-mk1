import { describe, expect, it } from "vitest";

import {
  assertCurrentAgentConnectionScope,
  signAgentConnectionClaims,
  verifyAgentConnectionToken,
  type AgentConnectionClaims,
} from "./agent-connection-token";
import type { AgentRow, ChatThreadRow } from "./types";

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

const thread = (input: Partial<ChatThreadRow> = {}): ChatThreadRow => ({
  thread_id: "thread-a",
  session_id: "session-a",
  user_id: "user-a",
  workspace_id: "workspace-a",
  agent_id: "agent-a",
  status: "active",
  upstream_json: "{}",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  last_seen_at: "2026-01-01T00:00:00.000Z",
  ...input,
});

const agent = (input: Partial<AgentRow> = {}): AgentRow => ({
  id: "agent-a",
  workspace_id: "workspace-a",
  name: "Agent A",
  description: null,
  status: "active",
  is_default: 1,
  created_by_user_id: "user-a",
  data_json: "{}",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
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

  it("rejects an old connection immediately after a thread agent handoff", () => {
    expect(() =>
      assertCurrentAgentConnectionScope(claims(), thread({ agent_id: "agent-b" }), agent()),
    ).toThrow("Agent token thread scope is stale");
  });

  it("rejects inactive and stale agent versions", () => {
    expect(() =>
      assertCurrentAgentConnectionScope(claims(), thread(), agent({ status: "inactive" })),
    ).toThrow("Agent token agent is inactive");
    expect(() =>
      assertCurrentAgentConnectionScope(
        claims({ agentUpdatedAt: "old-version" }),
        thread(),
        agent(),
      ),
    ).toThrow("Agent token agent version is stale");
  });
});
