import { describe, expect, it } from "vitest";

import { pruneSessionEvents, resolveSessionReplay } from "./session-agent-stream";
import type { WorkbenchSessionEvent } from "./session-event-types";

const event = (id: string, createdAt: string): WorkbenchSessionEvent => ({
  id,
  type: "workflow.run.updated",
  createdAt,
  data: { id },
});

describe("session event replay", () => {
  it("replays only events after a known cursor", () => {
    const events = [event("a", "2026-08-05T12:00:00.000Z"), event("b", "2026-08-05T12:01:00.000Z")];
    expect(
      resolveSessionReplay({
        after: "a",
        events,
        snapshotEvent: { ...events[0]!, id: "snapshot", type: "session.snapshot" },
      }),
    ).toEqual([events[1]]);
  });

  it("returns a reset snapshot for an expired or unknown cursor", () => {
    const snapshot = event("snapshot", "2026-08-05T12:02:00.000Z");
    const [reset] = resolveSessionReplay({
      after: "expired",
      events: [],
      snapshotEvent: { ...snapshot, type: "session.snapshot" },
    });
    expect(reset?.type).toBe("session.snapshot");
    expect(reset?.data.replayReset).toBe(true);
  });

  it("bounds persisted replay to 256 events and fifteen minutes", () => {
    const now = Date.parse("2026-08-05T12:30:00.000Z");
    const recent = Array.from({ length: 300 }, (_, index) =>
      event(`recent-${index}`, new Date(now - 60_000).toISOString()),
    );
    expect(
      pruneSessionEvents(
        [event("expired", new Date(now - 16 * 60_000).toISOString()), ...recent],
        now,
      ),
    ).toHaveLength(256);
  });
});
