import { describe, expect, it } from "vitest";

import {
  level2ConformanceSuites,
  missingLevel2Guarantees,
  requiredLevel2Guarantees,
} from "./level2-conformance";

describe("Level 2 conformance registry", () => {
  it("maps every required guarantee to executable evidence", () => {
    expect(level2ConformanceSuites.every((suite) => suite.command.startsWith("pnpm "))).toBe(true);
    expect(missingLevel2Guarantees()).toEqual([]);
    expect(new Set(requiredLevel2Guarantees).size).toBe(requiredLevel2Guarantees.length);
  });
});
