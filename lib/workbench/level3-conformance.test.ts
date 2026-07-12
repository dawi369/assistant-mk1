import { describe, expect, it } from "vitest";

import {
  level3ConformanceSuites,
  missingLevel3Guarantees,
  requiredLevel3Guarantees,
} from "./level3-conformance";

describe("Level 3 conformance registry", () => {
  it("maps every required guarantee to executable evidence", () => {
    expect(level3ConformanceSuites.every((suite) => suite.command.startsWith("pnpm "))).toBe(true);
    expect(missingLevel3Guarantees()).toEqual([]);
    expect(new Set(requiredLevel3Guarantees).size).toBe(requiredLevel3Guarantees.length);
  });

  it("does not report guarantees for suites that did not pass", () => {
    expect(missingLevel3Guarantees(new Set(["level3-forward-migration-boundary"]))).toContain(
      "trusted_triggers",
    );
  });
});
