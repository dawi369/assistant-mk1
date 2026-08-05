import type { WorkbenchSessionEvent } from "./session-event-types";
import { createId } from "./types";
import { sseEncoder, sseHeartbeatMs } from "./session-agent-model";
import { encodeHeartbeat } from "./session-agent-transitions";

export const pruneSessionEvents = (events: WorkbenchSessionEvent[], now = Date.now()) => {
  const cutoff = now - 15 * 60 * 1000;
  return events.filter((event) => Date.parse(event.createdAt) >= cutoff).slice(-256);
};

export const resolveSessionReplay = (input: {
  after?: string;
  events: WorkbenchSessionEvent[];
  snapshotEvent: WorkbenchSessionEvent;
}) => {
  if (!input.after) return [input.snapshotEvent];
  const cursorIndex = input.events.findIndex((event) => event.id === input.after);
  if (cursorIndex >= 0) return input.events.slice(cursorIndex + 1);
  return [
    {
      ...input.snapshotEvent,
      data: { ...input.snapshotEvent.data, replayReset: true },
    },
  ];
};

export const createSessionEventStream = (input: {
  clients: Map<string, ReadableStreamDefaultController<Uint8Array>>;
  initialEvents: WorkbenchSessionEvent[];
  sendEvent: (
    controller: ReadableStreamDefaultController<Uint8Array>,
    event: WorkbenchSessionEvent,
  ) => void;
}) => {
  const clientId = createId("cf-session-client");
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start: (controller) => {
      input.clients.set(clientId, controller);
      for (const event of input.initialEvents) input.sendEvent(controller, event);
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
