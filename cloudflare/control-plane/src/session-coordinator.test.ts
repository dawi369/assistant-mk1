import { describe, expect, it } from "vitest";

import type { AgentIdentity } from "./types";
import { sessionCoordinatorName, sessionCoordinatorProtocolVersion } from "./session-coordinator";

const identity = (userId: string, workspaceId: string): AgentIdentity =>
  ({
    scope: { userId, workspaceId },
  }) as AgentIdentity;

describe("session coordinator identity", () => {
  it("uses a versioned deterministic namespace", async () => {
    const first = await sessionCoordinatorName(identity("user-1", "workspace-1"));
    const second = await sessionCoordinatorName(identity("user-1", "workspace-1"));

    expect(first).toBe(second);
    expect(first).toMatch(
      new RegExp(`^session-v${sessionCoordinatorProtocolVersion}-[a-f0-9]{48}$`),
    );
  });

  it("isolates workspaces and users", async () => {
    const base = await sessionCoordinatorName(identity("user-1", "workspace-1"));

    await expect(sessionCoordinatorName(identity("user-1", "workspace-2"))).resolves.not.toBe(base);
    await expect(sessionCoordinatorName(identity("user-2", "workspace-1"))).resolves.not.toBe(base);
  });
});
