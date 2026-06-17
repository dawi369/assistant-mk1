import { describe, expect, it } from "vitest";

import { normalizeExternalSignal } from "./schedule-dispatch";

const now = new Date("2026-06-17T12:00:00.000Z");

describe("schedule dispatch normalization", () => {
  it("requires a schedule expression for cron creation", () => {
    expect(normalizeExternalSignal({ action: "create_cron" }, { now })).toEqual({
      ok: false,
      status: 400,
      error: "schedule is required for create_cron",
    });
  });

  it("annotates cron creation with root-owned schedule metadata when provided", () => {
    const result = normalizeExternalSignal(
      {
        action: "create_cron",
        schedule: "0 9 * * 1-5",
        scheduleId: "weekday-check",
        timezone: "America/New_York",
        input: { messages: [{ role: "user", content: "Run the check." }] },
      },
      { now },
    );

    expect(result).toMatchObject({
      ok: true,
      signal: {
        action: "create_cron",
        schedule: "0 9 * * 1-5",
        timezone: "America/New_York",
        metadata: {
          source: "external-signal",
          schedule: {
            kind: "schedule",
            scheduleId: "weekday-check",
            owner: "control-plane-root",
            source: "external_signal",
          },
        },
      },
    });
  });

  it("normalizes local schedule dispatch into run metadata", () => {
    const result = normalizeExternalSignal(
      {
        action: "dispatch_schedule",
        scheduleId: "weekday-check",
        scheduledFor: "2026-06-17T13:00:00.000Z",
        input: { messages: [{ role: "user", content: "Run the scheduled check." }] },
      },
      { now },
    );

    expect(result).toMatchObject({
      ok: true,
      signal: {
        action: "dispatch_schedule",
        input: { messages: [{ role: "user", content: "Run the scheduled check." }] },
        metadata: {
          source: "schedule-dispatch",
          scheduleDispatch: {
            kind: "schedule",
            scheduleId: "weekday-check",
            dispatchId: "schedule-dispatch:weekday-check:2026-06-17T12:00:00.000Z",
            scheduledFor: "2026-06-17T13:00:00.000Z",
            dispatchedAt: "2026-06-17T12:00:00.000Z",
            owner: "control-plane-root",
            source: "external_signal",
          },
        },
      },
    });
  });

  it("keeps start and resume behavior stable", () => {
    expect(
      normalizeExternalSignal({ action: "start", input: { messages: [] } }, { now }),
    ).toMatchObject({
      ok: true,
      signal: {
        action: "start",
        input: { messages: [] },
        metadata: { source: "external-signal" },
      },
    });

    expect(
      normalizeExternalSignal({ action: "resume", command: { resume: true } }, { now }),
    ).toMatchObject({
      ok: true,
      signal: {
        action: "resume",
        input: null,
        command: { resume: true },
        metadata: { source: "external-signal" },
      },
    });
  });
});
