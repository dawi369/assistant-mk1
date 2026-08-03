import type { WorkbenchSessionEvent } from "./session-event-types";
import { createId } from "./types";
import { sseEncoder, sseHeartbeatMs, type SessionSnapshot } from "./session-agent-model";
import { encodeHeartbeat } from "./session-agent-transitions";

export const createSessionEventStream = (input: {
  snapshot: SessionSnapshot;
  clients: Map<string, ReadableStreamDefaultController<Uint8Array>>;
  createEvent: (
    type: "session.snapshot",
    data: Record<string, unknown>,
    options: { revision: number },
  ) => WorkbenchSessionEvent;
  sendEvent: (
    controller: ReadableStreamDefaultController<Uint8Array>,
    event: WorkbenchSessionEvent,
  ) => void;
  snapshotData: Record<string, unknown>;
}) => {
  const clientId = createId("cf-session-client");
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start: (controller) => {
      input.clients.set(clientId, controller);
      input.sendEvent(
        controller,
        input.createEvent("session.snapshot", input.snapshotData, {
          revision: input.snapshot.revision,
        }),
      );
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(sseEncoder.encode(encodeHeartbeat()));
        } catch {
          input.clients.delete(clientId);
          if (heartbeat) clearInterval(heartbeat);
        }
      }, sseHeartbeatMs);
    },
    cancel: () => {
      input.clients.delete(clientId);
      if (heartbeat) clearInterval(heartbeat);
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
};
