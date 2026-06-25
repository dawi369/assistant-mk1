import { describe, expect, it } from "vitest";

import {
  artifactMetadataTestPolicy,
  artifactMetadataTestToolName,
  diagnosticPingPolicy,
  diagnosticPingToolName,
  polymarketMarketSearchToolName,
  polymarketReadonlyPolicy,
  repoSnapshotPolicy,
  repoSnapshotToolName,
  runnerEchoPolicy,
  runnerEchoToolName,
  swordfishReadonlyPolicy,
  swordfishRuntimeOverviewToolName,
  toolPolicyCatalog,
} from "./tool-policy";

describe("tool policy catalog", () => {
  it("registers repo.snapshot as admin-visible and model-hidden by default", () => {
    expect(toolPolicyCatalog[repoSnapshotToolName]).toMatchObject({
      policyReference: repoSnapshotPolicy,
      allowedExecutionModes: ["dry_run"],
      adminVisible: true,
      modelVisible: false,
      requiresApproval: false,
      status: "enabled",
      policyEditable: true,
      mutationRisk: "read_only",
    });
  });

  it("registers Admin conformance tools as dry-run-only and non-policy-editable", () => {
    expect(toolPolicyCatalog[diagnosticPingToolName]).toMatchObject({
      policyReference: diagnosticPingPolicy,
      allowedExecutionModes: ["dry_run"],
      adminVisible: true,
      modelVisible: false,
      requiresApproval: false,
      status: "enabled",
      policyEditable: false,
      mutationRisk: "read_only",
    });
    expect(toolPolicyCatalog[runnerEchoToolName]).toMatchObject({
      policyReference: runnerEchoPolicy,
      allowedExecutionModes: ["dry_run"],
      adminVisible: true,
      modelVisible: false,
      requiresApproval: false,
      status: "enabled",
      policyEditable: false,
      mutationRisk: "read_only",
    });
    expect(toolPolicyCatalog[artifactMetadataTestToolName]).toMatchObject({
      policyReference: artifactMetadataTestPolicy,
      allowedExecutionModes: ["dry_run"],
      adminVisible: true,
      modelVisible: false,
      requiresApproval: false,
      status: "enabled",
      policyEditable: false,
      mutationRisk: "read_only",
    });
  });

  it("registers Polymarket readonly tools as admin-visible and model-hidden", () => {
    expect(toolPolicyCatalog[polymarketMarketSearchToolName]).toMatchObject({
      policyReference: polymarketReadonlyPolicy,
      allowedExecutionModes: ["dry_run"],
      adminVisible: true,
      modelVisible: false,
      requiresApproval: false,
      status: "enabled",
      policyEditable: true,
      mutationRisk: "read_only",
    });
  });

  it("registers Swordfish readonly tools as admin-visible and model-hidden", () => {
    expect(toolPolicyCatalog[swordfishRuntimeOverviewToolName]).toMatchObject({
      policyReference: swordfishReadonlyPolicy,
      allowedExecutionModes: ["dry_run"],
      adminVisible: true,
      modelVisible: false,
      requiresApproval: false,
      status: "enabled",
      policyEditable: true,
      mutationRisk: "read_only",
    });
  });

  it("keeps every currently registered tool dry-run-only", () => {
    for (const [toolName, policy] of Object.entries(toolPolicyCatalog)) {
      expect(policy.mutationRisk, toolName).toBe("read_only");
      expect(policy.allowedExecutionModes, toolName).toEqual(["dry_run"]);
    }
  });
});
