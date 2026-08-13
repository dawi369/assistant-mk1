import { describe, expect, it } from "vitest";

import { sessionStreamReconnectPlan } from "./session-stream-policy";

describe("session stream reconnect policy", () => {
  it("keeps live state through an intentional bounded stream rollover", () => {
    expect(sessionStreamReconnectPlan(false)).toEqual({
      delayMs: 100,
      markDisconnected: false,
    });
  });

  it("surfaces genuine stream failures and backs off", () => {
    expect(sessionStreamReconnectPlan(true)).toEqual({
      delayMs: 2_000,
      markDisconnected: true,
    });
  });
});
