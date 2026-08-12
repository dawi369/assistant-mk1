import { describe, expect, it } from "vitest";

import { scrubSentryBreadcrumb, scrubSentryEvent } from "./sentry-scrubber";

const sentinel = "sentry-sensitive-sentinel";
const serialized = (value: unknown) => JSON.stringify(value);

describe("Sentry privacy scrubber", () => {
  it("removes request credentials, tenant payloads, and secret query values", () => {
    const event = scrubSentryEvent({
      user: { id: "user-1", email: "person@example.com" },
      request: {
        url: `https://example.com/callback?code=${sentinel}`,
        method: "POST",
        headers: {
          authorization: `Bearer ${sentinel}.payload.signature`,
          cookie: `session=${sentinel}`,
          "content-type": "application/json",
        },
        data: { workspace: { name: sentinel } },
      },
      extra: { access_token: sentinel, nested: { password: sentinel } },
    });

    expect(event).not.toHaveProperty("user");
    expect(event.request).toEqual({
      url: "https://example.com/callback",
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(serialized(event)).not.toContain(sentinel);
  });

  it("redacts secret-shaped exception and breadcrumb values", () => {
    const credential = `Bearer ${sentinel}.payload.signature`;
    const event = scrubSentryEvent({
      message: `request failed: ${credential}`,
      exception: { values: [{ type: "Error", value: credential }] },
    });
    const breadcrumb = scrubSentryBreadcrumb({
      category: "fetch",
      message: credential,
      data: { url: `https://example.com/path?token=${sentinel}`, password: sentinel },
    });

    expect(serialized(event)).not.toContain(sentinel);
    expect(serialized(breadcrumb)).not.toContain(sentinel);
    expect(breadcrumb.data.url).toBe("https://example.com/path");
  });
});
