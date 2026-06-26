import { describe, expect, it } from "vitest";

import {
  deriveThreadAgentInstanceName,
  resolveThreadAgentInstanceName,
} from "./chat-agent-connection-context";
import type { ChatThreadRow } from "./types";

const threadRow = (input: Partial<ChatThreadRow> = {}): ChatThreadRow => ({
  thread_id: "thread-a",
  session_id: "session-a",
  user_id: "user-a",
  workspace_id: "workspace-a",
  agent_id: "agent-a",
  status: "active",
  upstream_json: "{}",
  created_at: "2026-06-13T00:00:00.000Z",
  updated_at: "2026-06-13T00:00:00.000Z",
  last_seen_at: "2026-06-13T00:00:00.000Z",
  ...input,
});

describe("chat agent connection context", () => {
  it("derives thread-scoped instance names without agent identity", async () => {
    const first = await deriveThreadAgentInstanceName({
      userId: "user-a",
      workspaceId: "workspace-a",
      threadId: "thread-a",
    });
    const second = await deriveThreadAgentInstanceName({
      userId: "user-a",
      workspaceId: "workspace-a",
      threadId: "thread-a",
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^thread-[a-f0-9]{48}$/);
  });

  it("preserves stored instance names for existing threads", async () => {
    await expect(
      resolveThreadAgentInstanceName(
        threadRow({
          upstream_json: JSON.stringify({ instanceName: "legacy-agent-scoped-instance" }),
          agent_id: "agent-b",
        }),
      ),
    ).resolves.toBe("legacy-agent-scoped-instance");
  });

  it("falls back to the thread-scoped instance name when no stored name exists", async () => {
    const row = threadRow({ agent_id: "agent-b" });
    const expected = await deriveThreadAgentInstanceName({
      userId: row.user_id,
      workspaceId: row.workspace_id,
      threadId: row.thread_id,
    });

    await expect(resolveThreadAgentInstanceName(row)).resolves.toBe(expected);
  });
});
