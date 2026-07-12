import { describe, expect, it } from "vitest";

import { readJsonResponse } from "./read-json-response";

describe("readJsonResponse", () => {
  it("returns successful JSON responses", async () => {
    await expect(
      readJsonResponse<{ value: number }>(Response.json({ value: 42 }), "Request failed"),
    ).resolves.toEqual({ value: 42 });
  });

  it.each([
    [{ error: "Request denied" }, "Request denied"],
    [{ error: { message: "Nested request error" } }, "Nested request error"],
    [{ error: { message: 42 } }, "Request failed"],
  ])("uses the most useful error message from %j", async (body, message) => {
    await expect(
      readJsonResponse(new Response(JSON.stringify(body), { status: 400 }), "Request failed"),
    ).rejects.toThrow(message);
  });

  it("uses the fallback for non-JSON errors", async () => {
    await expect(
      readJsonResponse(new Response("not json", { status: 500 }), "Request failed"),
    ).rejects.toThrow("Request failed");
  });
});
