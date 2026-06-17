import { describe, expect, it } from "vitest";

import {
  realSessionEvalSuites,
  requiredRealSessionAssertions,
  summarizeRealSessionEvalPosture,
  supportingEvalContractChecks,
} from "./real-session-evals";

describe("real-session eval posture", () => {
  it("covers the required real-session assertions with HTTP/runtime suites", () => {
    const posture = summarizeRealSessionEvalPosture();

    expect(posture.ok).toBe(true);
    expect(posture.missingAssertions).toEqual([]);
    expect(posture.coveredAssertions).toEqual(
      expect.arrayContaining([...requiredRealSessionAssertions]),
    );
    expect(posture.surfaces).toEqual(
      expect.arrayContaining([
        "cloudflare_agent_session",
        "cloudflare_worker_http",
        "fly_runner_http",
      ]),
    );
  });

  it("keeps supporting contract checks separate from real-session suites", () => {
    expect(realSessionEvalSuites.some((suite) => suite.id.includes("schedule-dispatch"))).toBe(
      false,
    );
    expect(
      supportingEvalContractChecks.some((check) => check.id === "schedule-dispatch-contract"),
    ).toBe(true);
  });
});
