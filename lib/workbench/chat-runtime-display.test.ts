import { describe, it, expect } from "vitest";

import { chatRuntimeStateLabel, chatRuntimeStateTone } from "./chat-runtime-display";

describe("chatRuntimeStateLabel", () => {
  it("returns 'No chat yet' for no_session", () => {
    expect(chatRuntimeStateLabel("no_session")).toBe("No chat yet");
  });

  it("returns 'No chat yet' for no_thread", () => {
    expect(chatRuntimeStateLabel("no_thread")).toBe("No chat yet");
  });

  it("returns 'Ready' for thread_ready", () => {
    expect(chatRuntimeStateLabel("thread_ready")).toBe("Ready");
  });

  it("returns 'Blocked' for blocked", () => {
    expect(chatRuntimeStateLabel("blocked")).toBe("Blocked");
  });

  it("returns 'Running' for running", () => {
    expect(chatRuntimeStateLabel("running")).toBe("Running");
  });

  it("returns 'Failed' for failed", () => {
    expect(chatRuntimeStateLabel("failed")).toBe("Failed");
  });

  it("returns 'Completed' for completed", () => {
    expect(chatRuntimeStateLabel("completed")).toBe("Completed");
  });

  it("returns 'Loading' for null", () => {
    expect(chatRuntimeStateLabel(null)).toBe("Loading");
  });

  it("returns 'Loading' for undefined", () => {
    expect(chatRuntimeStateLabel(undefined)).toBe("Loading");
  });
});

describe("chatRuntimeStateTone", () => {
  it("returns 'completed' for thread_ready", () => {
    expect(chatRuntimeStateTone("thread_ready")).toBe("completed");
  });

  it("returns 'completed' for completed", () => {
    expect(chatRuntimeStateTone("completed")).toBe("completed");
  });

  it("returns 'running' for running", () => {
    expect(chatRuntimeStateTone("running")).toBe("running");
  });

  it("returns 'failed' for blocked", () => {
    expect(chatRuntimeStateTone("blocked")).toBe("failed");
  });

  it("returns 'failed' for failed", () => {
    expect(chatRuntimeStateTone("failed")).toBe("failed");
  });

  it("returns undefined for no_session", () => {
    expect(chatRuntimeStateTone("no_session")).toBeUndefined();
  });

  it("returns undefined for no_thread", () => {
    expect(chatRuntimeStateTone("no_thread")).toBeUndefined();
  });

  it("returns undefined for null", () => {
    expect(chatRuntimeStateTone(null)).toBeUndefined();
  });

  it("returns undefined for undefined", () => {
    expect(chatRuntimeStateTone(undefined)).toBeUndefined();
  });
});
