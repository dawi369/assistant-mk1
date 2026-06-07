import { describe, it, expect } from "vitest";

import { deriveChatExecutionMode, evaluateChatRunPolicy } from "./chat-policy";
import type { ChatRunRow } from "./types";

describe("deriveChatExecutionMode", () => {
  it("defaults to 'ask' when body is not a record", () => {
    expect(deriveChatExecutionMode(null)).toEqual({
      executionMode: "ask",
      requestedExecutionMode: undefined,
    });
    expect(deriveChatExecutionMode("string")).toEqual({
      executionMode: "ask",
      requestedExecutionMode: undefined,
    });
    expect(deriveChatExecutionMode(42)).toEqual({
      executionMode: "ask",
      requestedExecutionMode: undefined,
    });
  });

  it("defaults to 'ask' when execution_mode is missing", () => {
    expect(deriveChatExecutionMode({})).toEqual({
      executionMode: "ask",
      requestedExecutionMode: undefined,
    });
    expect(deriveChatExecutionMode({ other: "field" })).toEqual({
      executionMode: "ask",
      requestedExecutionMode: undefined,
    });
  });

  it("returns 'ask' for valid 'ask' mode", () => {
    const result = deriveChatExecutionMode({ execution_mode: "ask" });
    expect(result.executionMode).toBe("ask");
    expect(result.requestedExecutionMode).toBe("ask");
  });

  it("returns 'dry_run' for valid 'dry_run' mode", () => {
    const result = deriveChatExecutionMode({ execution_mode: "dry_run" });
    expect(result.executionMode).toBe("dry_run");
    expect(result.requestedExecutionMode).toBe("dry_run");
  });

  it("returns 'execute' for valid 'execute' mode", () => {
    const result = deriveChatExecutionMode({ execution_mode: "execute" });
    expect(result.executionMode).toBe("execute");
    expect(result.requestedExecutionMode).toBe("execute");
  });

  it("falls back to 'ask' for invalid execution_mode string", () => {
    const result = deriveChatExecutionMode({ execution_mode: "yolo" });
    expect(result.executionMode).toBe("ask");
    expect(result.invalidExecutionMode).toBe("yolo");
    expect(result.requestedExecutionMode).toBe("yolo");
  });

  it("defaults to 'ask' when execution_mode is not a string", () => {
    const result = deriveChatExecutionMode({ execution_mode: 123 });
    expect(result.executionMode).toBe("ask");
    expect(result.requestedExecutionMode).toBeUndefined();
  });
});

const makeRunRow = (overrides?: Partial<ChatRunRow>): ChatRunRow => ({
  id: "run-1",
  intent_id: "i1",
  policy_decision_id: "pd1",
  thread_id: "t1",
  user_id: "u1",
  workspace_id: "w1",
  agent_id: "a1",
  upstream_run_id: null,
  status: "running",
  metadata_json: "{}",
  error: null,
  started_at: "2025-01-01T00:00:00Z",
  completed_at: null,
  failed_at: null,
  updated_at: "2025-01-01T00:00:00Z",
  ...overrides,
});

describe("evaluateChatRunPolicy", () => {
  it("allows 'ask' mode with no running run", () => {
    const result = evaluateChatRunPolicy({
      executionMode: "ask",
      runningRun: null,
    });
    expect(result).toEqual({
      decision: "allow",
      executionMode: "ask",
      reason: "Chat ask mode is allowed by dev policy",
      status: 200,
    });
  });

  it("allows 'dry_run' mode with no running run", () => {
    const result = evaluateChatRunPolicy({
      executionMode: "dry_run",
      runningRun: null,
    });
    expect(result).toEqual({
      decision: "allow",
      executionMode: "dry_run",
      reason: "Chat dry_run mode is allowed by dev policy",
      status: 200,
    });
  });

  it("blocks when there is a running run", () => {
    const result = evaluateChatRunPolicy({
      executionMode: "ask",
      runningRun: makeRunRow(),
    });
    expect(result.decision).toBe("block");
    expect(result.status).toBe(409);
    expect(result.reason).toMatch(/already running/);
  });

  it("blocks 'execute' mode", () => {
    const result = evaluateChatRunPolicy({
      executionMode: "execute",
      runningRun: null,
    });
    expect(result.decision).toBe("block");
    expect(result.status).toBe(403);
    expect(result.reason).toMatch(/approval policy/);
  });

  it("blocks invalid execution mode", () => {
    const result = evaluateChatRunPolicy({
      executionMode: "ask",
      invalidExecutionMode: "yolo",
      runningRun: null,
    });
    expect(result.decision).toBe("block");
    expect(result.status).toBe(403);
    expect(result.reason).toMatch(/yolo/);
  });

  it("invalid execution mode takes priority over running run", () => {
    const result = evaluateChatRunPolicy({
      executionMode: "ask",
      invalidExecutionMode: "bad",
      runningRun: makeRunRow(),
    });
    expect(result.decision).toBe("block");
    expect(result.status).toBe(403);
    expect(result.reason).toMatch(/bad/);
  });
});
