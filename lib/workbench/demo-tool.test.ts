import { describe, it, expect } from "vitest";

import { demoInspectTool } from "./demo-tool";
import type { ToolExecutionContext } from "@/lib/agent-framework/contracts";

const scope = { userId: "u1", workspaceId: "test-workspace" };
const context: ToolExecutionContext = {
  scope,
  execution: { mode: "dry_run" },
};

describe("demoInspectTool", () => {
  it("has the correct name", () => {
    expect(demoInspectTool.name).toBe("demo.inspect");
  });

  it("has kind 'native'", () => {
    expect(demoInspectTool.kind).toBe("native");
  });

  it("has a 1-second timeout", () => {
    expect(demoInspectTool.timeoutMs).toBe(1_000);
  });

  it("returns ok: true with expected output structure", async () => {
    const result = await demoInspectTool.execute({ target: "workspace" }, context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output.inspectedTarget).toBe("workspace");
      expect(result.output.checks).toHaveLength(3);
      expect(result.output.summary).toMatch(/completed/i);
    }
  });

  it("includes the workspace ID in the tenant_scope check", async () => {
    const result = await demoInspectTool.execute({ target: "workspace" }, context);
    if (result.ok) {
      const tenantCheck = result.output.checks.find((c) => c.name === "tenant_scope");
      expect(tenantCheck).toBeDefined();
      expect(tenantCheck!.status).toBe("pass");
      expect(tenantCheck!.summary).toContain("test-workspace");
    }
  });

  it("includes all three expected checks", async () => {
    const result = await demoInspectTool.execute({ target: "workspace" }, context);
    if (result.ok) {
      const checkNames = result.output.checks.map((c) => c.name);
      expect(checkNames).toEqual(["tenant_scope", "tool_policy", "durable_outputs"]);
      expect(result.output.checks.every((c) => c.status === "pass")).toBe(true);
    }
  });

  it("includes an audit summary", async () => {
    const result = await demoInspectTool.execute({ target: "workspace" }, context);
    if (result.ok) {
      expect(result.auditSummary).toMatch(/demo\.inspect/);
    }
  });
});
