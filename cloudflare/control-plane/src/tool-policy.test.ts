import { describe, expect, it } from "vitest";

import { repoSnapshotPolicy, repoSnapshotToolName, toolPolicyCatalog } from "./tool-policy";

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
});
