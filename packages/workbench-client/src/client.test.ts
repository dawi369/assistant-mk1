import { describe, expect, it, vi } from "vitest";

import { createWorkbenchClient } from "./client.js";

const jsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });

describe("createWorkbenchClient", () => {
  it("uses bearer authority and redaction-safe client metadata", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ ok: true, workspaces: [] }, { headers: { "x-request-id": "req_1" } }),
    );
    const client = createWorkbenchClient({
      baseUrl: "https://workbench.example/",
      client: { platform: "ios", version: "1.2.3" },
      fetch: fetcher,
      getAccessToken: async () => "mobile-token",
    });

    await client.workspaces.list();

    const [url, init] = fetcher.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(url).toBe("https://workbench.example/api/workbench/workspaces");
    expect(headers.get("authorization")).toBe("Bearer mobile-token");
    expect(headers.get("x-workbench-client-platform")).toBe("ios");
    expect(headers.get("x-workbench-client-version")).toBe("1.2.3");
    expect(init?.credentials).toBe("omit");
  });

  it("preserves cookie sessions when no bearer token is supplied", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => jsonResponse({ ok: true, agents: [] }));
    const client = createWorkbenchClient({
      baseUrl: "",
      client: { platform: "web", version: "0.1.0" },
      fetch: fetcher,
    });

    await client.agents.list();

    expect(fetcher.mock.calls[0]![1]?.credentials).toBe("include");
  });

  it("uses stable turn identity for materialization", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => jsonResponse({ ok: true }));
    const client = createWorkbenchClient({
      baseUrl: "https://workbench.example",
      client: { platform: "android", version: "0.1.0" },
      fetch: fetcher,
    });

    await client.session.materializeTurn({ clientTurnId: "turn_1", text: "hello" });

    const headers = new Headers(fetcher.mock.calls[0]![1]?.headers);
    expect(headers.get("idempotency-key")).toBe("turn_1");
    expect(fetcher.mock.calls[0]![1]?.body).toBe(
      JSON.stringify({ message: "hello", clientTurnId: "turn_1" }),
    );
  });

  it("rejects malformed successful responses", async () => {
    const client = createWorkbenchClient({
      baseUrl: "https://workbench.example",
      client: { platform: "web", version: "0.1.0" },
      fetch: async () => jsonResponse({ ok: true, runs: {} }),
    });

    await expect(client.history.listRuns()).rejects.toMatchObject({
      code: "invalid_response",
      status: 0,
      retryable: false,
    });
  });

  it("fails closed on an unsupported chat protocol", async () => {
    const client = createWorkbenchClient({
      baseUrl: "https://workbench.example",
      client: { platform: "ios", version: "0.1.0" },
      fetch: async () => jsonResponse({ ok: true, connection: { chatProtocolVersion: 2 } }),
    });

    await expect(client.session.get()).rejects.toMatchObject({
      code: "invalid_response",
      status: 0,
    });
  });

  it("normalizes API failures without exposing response bodies", async () => {
    const client = createWorkbenchClient({
      baseUrl: "https://workbench.example",
      client: { platform: "web", version: "0.1.0" },
      fetch: async () =>
        jsonResponse(
          { error: "Not found", code: "not_found", retryable: false, secret: "hidden" },
          { status: 404, headers: { "x-request-id": "req_404" } },
        ),
    });

    await expect(client.history.getRun("run_404")).rejects.toMatchObject({
      message: "Not found",
      code: "not_found",
      requestId: "req_404",
      retryable: false,
      status: 404,
    });
  });
});
