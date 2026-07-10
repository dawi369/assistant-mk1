import { describe, expect, it } from "vitest";

import { hasWorkbenchSessionAccess } from "./session-access";
import type { ChatSessionResponse } from "./workbench-types";

const liveLocalSession = {
  ok: true,
  workspace: { id: "dev-workspace", name: "Local", status: "active", isDefault: true },
} satisfies ChatSessionResponse;

describe("workbench session access", () => {
  it("accepts a WorkOS user or a fresh server-resolved local session", () => {
    expect(hasWorkbenchSessionAccess({ hasWorkOsUser: true })).toBe(true);
    expect(hasWorkbenchSessionAccess({ hasWorkOsUser: false, session: liveLocalSession })).toBe(
      true,
    );
  });

  it("never grants access from a stale cache or failed session request", () => {
    expect(
      hasWorkbenchSessionAccess({
        hasWorkOsUser: false,
        session: { ...liveLocalSession, isStale: true },
      }),
    ).toBe(false);
    expect(
      hasWorkbenchSessionAccess({
        hasWorkOsUser: false,
        session: liveLocalSession,
        sessionError: "Authentication required",
      }),
    ).toBe(false);
  });
});
