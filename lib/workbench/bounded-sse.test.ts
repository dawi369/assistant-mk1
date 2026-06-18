import { describe, expect, it } from "vitest";

import { createBoundedSseStream } from "./bounded-sse";

const encoder = new TextEncoder();

describe("bounded SSE stream", () => {
  it("closes with a reconnect marker before the runtime timeout window", async () => {
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("event: session.snapshot\ndata: {}\n\n"));
      },
    });

    const bounded = createBoundedSseStream({
      body: source,
      maxDurationMs: 5,
      reconnectComment: "test bounded reconnect",
    });

    const text = await new Response(bounded).text();

    expect(text).toContain("event: session.snapshot");
    expect(text).toContain(": test bounded reconnect");
  });

  it("passes null bodies through as null", () => {
    expect(createBoundedSseStream({ body: null, maxDurationMs: 5 })).toBeNull();
  });
});
