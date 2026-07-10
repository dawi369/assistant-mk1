import { describe, expect, it, vi } from "vitest";

import { sendQueuedDraftWhenReady } from "./runtime-draft-handoff";

describe("sendQueuedDraftWhenReady", () => {
  it("waits for the Agent connection before sending the queued draft", async () => {
    let resolveReady!: () => void;
    const connectionReady = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    let text = "";
    const setText = vi.fn((nextText: string) => {
      text = nextText;
    });
    const send = vi.fn();

    const handoff = sendQueuedDraftWhenReady({
      connectionReady,
      draft: "Run the readiness check",
      getComposer: () => ({ getState: () => ({ text }), setText, send }),
      waitForCommit: async () => undefined,
    });

    expect(setText).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();

    resolveReady();
    await expect(handoff).resolves.toBe(true);
    expect(setText).toHaveBeenCalledWith("Run the readiness check");
    expect(send).toHaveBeenCalledOnce();
  });

  it("does not clear or send a queued draft after the handoff is cancelled", async () => {
    let resolveReady!: () => void;
    const connectionReady = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    let cancelled = false;
    const send = vi.fn();

    const handoff = sendQueuedDraftWhenReady({
      connectionReady,
      draft: "Queued prompt",
      getComposer: () => ({
        getState: () => ({ text: "Queued prompt" }),
        setText: vi.fn(),
        send,
      }),
      isCancelled: () => cancelled,
      waitForCommit: async () => undefined,
    });

    cancelled = true;
    resolveReady();
    await expect(handoff).resolves.toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});
