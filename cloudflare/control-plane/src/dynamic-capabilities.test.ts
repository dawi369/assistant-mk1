import { describe, expect, it } from "vitest";

import { readDynamicCapabilityContext, toDynamicCapabilityDecision } from "./dynamic-capabilities";
import type { ToolPolicyResult } from "./tool-policy";

const policyResult: ToolPolicyResult = {
  decision: "allow",
  status: 200,
  code: "allowed",
  reason: "url.inspect is exposed to the model by workspace policy.",
  executionMode: "dry_run",
  policyReference: "tool-admin-readonly-v0",
  adminVisible: true,
  modelVisible: true,
  approvalRequired: false,
  allowedExecutionModes: ["dry_run"],
  policyEditable: true,
  constraints: {
    limits: {},
    allowlist: ["example.com"],
    denylist: [],
  },
};

describe("dynamic capability resolution", () => {
  it("reads a bounded capability context from query parameters", () => {
    const context = readDynamicCapabilityContext(
      new URL(
        "https://worker.test/tools?stage=review&executionMode=dry_run&surface=admin_list&featureFlags=alpha, bad flag,tool:v0",
      ),
    );

    expect(context).toEqual({
      stage: "review",
      executionMode: "dry_run",
      surface: "admin_list",
      platform: "cloudflare-control-plane",
      featureFlags: ["alpha", "tool:v0"],
    });
  });

  it("falls back to safe defaults for unsupported context values", () => {
    const context = readDynamicCapabilityContext(
      new URL("https://worker.test/tools?stage=ship&executionMode=execute_now&surface=root"),
    );

    expect(context).toEqual({
      stage: "observe",
      executionMode: "dry_run",
      surface: "model_exposure",
      platform: "cloudflare-control-plane",
      featureFlags: [],
    });
  });

  it("maps tool policy results to compact redacted capability decisions", () => {
    const decision = toDynamicCapabilityDecision("url.inspect", policyResult);

    expect(decision).toMatchObject({
      capabilityId: "url.inspect",
      kind: "tool",
      visible: true,
      decision: "allow",
      code: "allowed",
      policyReference: "tool-admin-readonly-v0",
      allowedExecutionModes: ["dry_run"],
      adminVisible: true,
      modelVisible: true,
    });
    expect(JSON.stringify(decision)).not.toMatch(/secret|accessToken|refreshToken|prompt|message/i);
  });
});
