import { describe, expect, it } from "vitest";

import { readControlEventReplayAfter } from "./control-plane-events";

describe("control-plane event replay cursor", () => {
  it("uses the after query parameter before Last-Event-ID", () => {
    const url = new URL("https://worker.test/events/stream?after=query-event");
    const headers = new Headers({ "Last-Event-ID": "header-event" });

    expect(readControlEventReplayAfter(url, headers)).toBe("query-event");
  });

  it("uses Last-Event-ID when after is absent", () => {
    const url = new URL("https://worker.test/events/stream");
    const headers = new Headers({ "Last-Event-ID": "header-event" });

    expect(readControlEventReplayAfter(url, headers)).toBe("header-event");
  });
});
