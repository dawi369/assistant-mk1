import { describe, expect, it } from "vitest";

import {
  coalesceDueOccurrence,
  nextCronOccurrence,
  nextMonitorOccurrence,
} from "./trigger-schedule";

describe("trigger schedules", () => {
  it("calculates five-field cron occurrences in an IANA timezone", () => {
    const next = nextCronOccurrence({
      cron: "0 9 * * 1",
      timezone: "America/New_York",
      after: new Date("2026-07-10T12:00:00.000Z"),
    });
    expect(next.toISOString()).toBe("2026-07-13T13:00:00.000Z");
  });

  it("rejects unsupported cron precision and invalid timezones", () => {
    expect(() =>
      nextCronOccurrence({
        cron: "0 0 9 * * 1",
        timezone: "UTC",
        after: new Date("2026-07-10T12:00:00.000Z"),
      }),
    ).toThrow("exactly five fields");
    expect(() =>
      nextCronOccurrence({
        cron: "0 9 * * 1",
        timezone: "Mars/Olympus",
        after: new Date("2026-07-10T12:00:00.000Z"),
      }),
    ).toThrow("valid IANA");
  });

  it("bounds monitor intervals", () => {
    expect(
      nextMonitorOccurrence({
        intervalSeconds: 60,
        after: new Date("2026-07-10T12:00:00.000Z"),
      }).toISOString(),
    ).toBe("2026-07-10T12:01:00.000Z");
    expect(() =>
      nextMonitorOccurrence({
        intervalSeconds: 30,
        after: new Date("2026-07-10T12:00:00.000Z"),
      }),
    ).toThrow("between 60 and 86400");
  });

  it("coalesces missed monitor occurrences into one dispatch", () => {
    const result = coalesceDueOccurrence({
      kind: "monitor",
      config: { intervalSeconds: 60 },
      scheduledFor: new Date("2026-07-10T12:00:00.000Z"),
      now: new Date("2026-07-10T12:03:30.000Z"),
    });
    expect(result).toMatchObject({ due: true, skippedOccurrences: 3 });
    expect(result.nextTriggerAt.toISOString()).toBe("2026-07-10T12:04:00.000Z");
  });
});
