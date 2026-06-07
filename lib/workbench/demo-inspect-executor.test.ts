import { describe, it, expect } from "vitest";

import { validateDemoInspectExecutorRequest } from "./demo-inspect-executor";
import type { DemoInspectExecutorRequest } from "./demo-inspect-executor";

const validRequest: DemoInspectExecutorRequest = {
  runId: "run-1",
  workflowIntentId: "wi-1",
  scope: { userId: "u1", workspaceId: "w1" },
  agentId: "agent-1",
  callbackUrl: "https://example.com/callback",
  callbackToken: "token-abc",
};

describe("validateDemoInspectExecutorRequest", () => {
  it("returns ok for a fully valid request", () => {
    const result = validateDemoInspectExecutorRequest(validRequest);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.runId).toBe("run-1");
      expect(result.request.workflowIntentId).toBe("wi-1");
      expect(result.request.scope).toEqual({ userId: "u1", workspaceId: "w1" });
      expect(result.request.agentId).toBe("agent-1");
      expect(result.request.callbackUrl).toBe("https://example.com/callback");
      expect(result.request.callbackToken).toBe("token-abc");
    }
  });

  it("fails when runId is missing", () => {
    const result = validateDemoInspectExecutorRequest({
      ...validRequest,
      runId: undefined,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/runId/);
    }
  });

  it("fails when workflowIntentId is missing", () => {
    const result = validateDemoInspectExecutorRequest({
      ...validRequest,
      workflowIntentId: undefined,
    });
    expect(result.ok).toBe(false);
  });

  it("fails when callbackUrl is missing", () => {
    const result = validateDemoInspectExecutorRequest({
      ...validRequest,
      callbackUrl: undefined,
    });
    expect(result.ok).toBe(false);
  });

  it("fails when callbackToken is missing", () => {
    const result = validateDemoInspectExecutorRequest({
      ...validRequest,
      callbackToken: undefined,
    });
    expect(result.ok).toBe(false);
  });

  it("fails when scope.userId is missing", () => {
    const result = validateDemoInspectExecutorRequest({
      ...validRequest,
      scope: { workspaceId: "w1" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/userId/);
    }
  });

  it("fails when scope.workspaceId is missing", () => {
    const result = validateDemoInspectExecutorRequest({
      ...validRequest,
      scope: { userId: "u1" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/workspaceId/);
    }
  });

  it("fails when agentId is missing", () => {
    const result = validateDemoInspectExecutorRequest({
      ...validRequest,
      agentId: undefined,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/agentId/);
    }
  });

  it("fails when scope is entirely missing", () => {
    const result = validateDemoInspectExecutorRequest({
      ...validRequest,
      scope: undefined,
    });
    expect(result.ok).toBe(false);
  });

  it("trims whitespace from scope fields", () => {
    const result = validateDemoInspectExecutorRequest({
      ...validRequest,
      scope: { userId: "  u1  ", workspaceId: "  w1  " },
      agentId: "  agent-1  ",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.scope.userId).toBe("u1");
      expect(result.request.scope.workspaceId).toBe("w1");
      expect(result.request.agentId).toBe("agent-1");
    }
  });

  it("rejects empty-after-trim scope fields", () => {
    const result = validateDemoInspectExecutorRequest({
      ...validRequest,
      scope: { userId: "   ", workspaceId: "w1" },
    });
    expect(result.ok).toBe(false);
  });
});
