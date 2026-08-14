import { describe, expect, it } from "vitest";

import {
  createMobileDeviceEvidenceTemplate,
  mobileDeviceChecks,
  parseMobileDeviceEvidence,
} from "./mobile-device-evidence-lib";

const validEvidence = () => {
  const template = createMobileDeviceEvidenceTemplate({
    commit: "a".repeat(40),
    operator: "release-operator",
    workosApplicationId: "mobile-public-client",
  });
  for (const platform of ["ios", "android"] as const) {
    template.platforms[platform].device = {
      name: `${platform}-device`,
      model: `${platform}-model`,
      osVersion: "27.0",
      appBuild: "internal-preview-1",
    };
    for (const check of mobileDeviceChecks) {
      template.platforms[platform].checks[check] = {
        status: "passed",
        completedAt: "2026-08-14T12:00:00.000Z",
        ...(check === "signIn" ? { screenshot: `output/mobile/${platform}/sign-in.png` } : {}),
      };
    }
  }
  return template;
};

describe("mobile device evidence", () => {
  it("accepts complete same-commit iOS and Android proof", () => {
    expect(parseMobileDeviceEvidence(validEvidence()).commit).toBe("a".repeat(40));
  });

  it("rejects unexecuted checks and missing screenshots", () => {
    const evidence = validEvidence();
    evidence.platforms.ios.checks.earlySend = { status: "not-run", completedAt: null };
    expect(() => parseMobileDeviceEvidence(evidence)).toThrow(/passed ios\.earlySend/);

    const withoutScreenshots = validEvidence();
    delete withoutScreenshots.platforms.android.checks.signIn.screenshot;
    expect(() => parseMobileDeviceEvidence(withoutScreenshots)).toThrow(/android screenshot/);
  });

  it("rejects credential-shaped fields and values", () => {
    const evidence = validEvidence() as Record<string, unknown>;
    evidence.authorization = "Bearer hidden";
    expect(() => parseMobileDeviceEvidence(evidence)).toThrow(/forbidden field/);

    const secret = validEvidence();
    secret.operator = `sk_test_${"a".repeat(24)}`;
    expect(() => parseMobileDeviceEvidence(secret)).toThrow(/credential-shaped/);
  });
});
