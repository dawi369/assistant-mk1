import { describe, expect, it } from "vitest";

import { sessionContainsThread } from "./delete-reconciliation";

const session = (overrides: Parameters<typeof sessionContainsThread>[0] = {}) => ({
  activeThread: null,
  threads: [],
  ...overrides,
});

describe("sessionContainsThread", () => {
  it("finds the active thread even when the summary list is stale", () => {
    expect(
      sessionContainsThread(
        session({ activeThread: { threadId: "thread-active" } }),
        "thread-active",
      ),
    ).toBe(true);
  });

  it("finds a thread in the authoritative thread list", () => {
    expect(
      sessionContainsThread(session({ threads: [{ threadId: "thread-listed" }] }), "thread-listed"),
    ).toBe(true);
  });

  it("reports an orphaned cached thread as absent", () => {
    expect(sessionContainsThread(session(), "thread-orphaned")).toBe(false);
  });
});
