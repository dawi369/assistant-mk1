import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  refreshAdminSummary,
  resetAdminSummaryResourceForTests,
  scheduleAdminSummaryRefresh,
  setAdminSummaryProjectionPreference,
} from "./admin-summary-resource";

const summaryBody = {
  summary: {
    generatedAt: "2026-06-18T12:00:00.000Z",
  },
};

const jsonResponse = (body = summaryBody) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("admin summary resource", () => {
  beforeEach(() => {
    resetAdminSummaryResourceForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    resetAdminSummaryResourceForTests();
  });

  it("dedupes concurrent non-forced refreshes", async () => {
    let resolveResponse: (response: Response) => void = () => undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveResponse = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = refreshAdminSummary({ source: "initial" });
    const second = refreshAdminSummary({ source: "event" });
    resolveResponse(jsonResponse());

    const [firstSnapshot, secondSnapshot] = await Promise.all([first, second]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/workbench/admin-summary?projection=compact", {
      cache: "no-store",
    });
    expect(firstSnapshot.summary?.generatedAt).toBe(summaryBody.summary.generatedAt);
    expect(secondSnapshot.summary?.generatedAt).toBe(summaryBody.summary.generatedAt);
  });

  it("uses cooldown for automated refreshes and bypasses it for forced refreshes", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse()));
    vi.stubGlobal("fetch", fetchMock);

    await refreshAdminSummary({ source: "initial" });
    await refreshAdminSummary({ source: "event" });
    await refreshAdminSummary({ source: "manual", force: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/workbench/admin-summary?projection=compact", {
      cache: "no-store",
    });
  });

  it("uses drawer projection while the Admin drawer preference is active", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse()));
    vi.stubGlobal("fetch", fetchMock);

    setAdminSummaryProjectionPreference("drawer");
    await refreshAdminSummary({ source: "drawer-open", force: true });

    expect(fetchMock).toHaveBeenCalledWith("/api/workbench/admin-summary?projection=drawer", {
      cache: "no-store",
    });
  });

  it("coalesces same-tick scheduled refreshes", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse()));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    });

    void scheduleAdminSummaryRefresh({ source: "event" });
    void scheduleAdminSummaryRefresh({ source: "fallback-poll" });
    await vi.runAllTimersAsync();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
