import { describe, expect, it } from "vitest";

import {
  parseNativeMismatches,
  validateNativeMismatches,
} from "./check-mobile-native-dependencies";

const mismatch = {
  package: "expo-router",
  current: "57.0.8",
  expected: "~57.0.13",
  reviewAfter: "2026-08-21T14:30:00.000Z",
};

describe("mobile native dependency boundary", () => {
  it("parses scoped and unscoped Expo validation output", () => {
    expect(
      parseNativeMismatches(`
  expo-router@57.0.8 - expected version: ~57.0.13
  @sentry/react-native@8.22.0 - expected version: ~7.11.0
`),
    ).toEqual([
      { package: "expo-router", current: "57.0.8", expected: "~57.0.13" },
      { package: "@sentry/react-native", current: "8.22.0", expected: "~7.11.0" },
    ]);
  });

  it("allows only an exact, unexpired patch deferral", () => {
    expect(() =>
      validateNativeMismatches([mismatch], [mismatch], new Date("2026-08-20T00:00:00Z")),
    ).not.toThrow();
    expect(() =>
      validateNativeMismatches([mismatch], [mismatch], new Date("2026-08-22T00:00:00Z")),
    ).toThrow("deferral expired");
    expect(() =>
      validateNativeMismatches([{ ...mismatch, current: "57.0.7" }], [mismatch]),
    ).toThrow("Unsupported native dependency drift");
  });
});
