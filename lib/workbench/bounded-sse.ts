const encoder = new TextEncoder();

export type BoundedSseStreamInput = {
  body: ReadableStream<Uint8Array> | null;
  maxDurationMs: number;
  reconnectComment?: string;
};

export const createBoundedSseStream = ({
  body,
  maxDurationMs,
  reconnectComment = "bounded-reconnect",
}: BoundedSseStreamInput) => {
  if (!body) return null;

  const reader = body.getReader();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const clearTimer = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const closeForReconnect = () => {
        if (closed) return;
        closed = true;
        clearTimer();
        controller.enqueue(encoder.encode(`: ${reconnectComment}\n\n`));
        controller.close();
        void reader.cancel("bounded_sse_reconnect").catch(() => undefined);
      };

      timer = setTimeout(closeForReconnect, maxDurationMs);

      const pump = async () => {
        try {
          while (!closed) {
            const chunk = await reader.read();
            if (chunk.done) break;
            if (chunk.value) controller.enqueue(chunk.value);
          }
          if (!closed) {
            closed = true;
            clearTimer();
            controller.close();
          }
        } catch (error) {
          if (!closed) {
            closed = true;
            clearTimer();
            controller.error(error);
          }
        }
      };

      void pump();
    },
    cancel(reason) {
      closed = true;
      clearTimer();
      return reader.cancel(reason);
    },
  });
};
