import { describe, expect, it } from "vitest";

import {
  canTransitionTrigger,
  canTransitionTriggerDispatch,
  isTerminalTriggerDispatchStatus,
} from "./trigger-transitions";

describe("trigger transitions", () => {
  it("makes disabled triggers terminal", () => {
    expect(canTransitionTrigger("enabled", "paused")).toBe(true);
    expect(canTransitionTrigger("paused", "enabled")).toBe(true);
    expect(canTransitionTrigger("enabled", "disabled")).toBe(true);
    expect(canTransitionTrigger("disabled", "enabled")).toBe(false);
  });

  it("requires explicit replay to lease terminal unsuccessful dispatches", () => {
    expect(canTransitionTriggerDispatch("pending", "leased")).toBe(true);
    expect(canTransitionTriggerDispatch("running", "completed")).toBe(true);
    expect(canTransitionTriggerDispatch("completed", "leased")).toBe(false);
    expect(canTransitionTriggerDispatch("failed", "leased")).toBe(true);
    expect(canTransitionTriggerDispatch("cancelled", "leased")).toBe(true);
  });

  it("identifies terminal dispatch states", () => {
    expect(isTerminalTriggerDispatchStatus("completed")).toBe(true);
    expect(isTerminalTriggerDispatchStatus("failed")).toBe(true);
    expect(isTerminalTriggerDispatchStatus("cancelled")).toBe(true);
    expect(isTerminalTriggerDispatchStatus("running")).toBe(false);
  });
});
