import { describe, it, expect } from "vitest";

import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExposureContext,
  TenantScope,
} from "./contracts";
import {
  RuntimeToolRegistry,
  createRuntimeToolRegistry,
  defaultToolExposureResolver,
  resolveToolExposure,
  getVisibleTools,
  executeRegisteredTool,
} from "./tool-runtime";

const scope: TenantScope = { userId: "u1", workspaceId: "w1" };
const execution = { mode: "dry_run" as const };

const makeTool = (
  name: string,
  opts?: { isAvailable?: (s: TenantScope) => boolean },
): ToolDefinition => ({
  name,
  description: `test tool ${name}`,
  execute: async (input, _ctx) => ({ ok: true, output: { y: (input as { x: number }).x + 1 } }),
  isAvailable: opts?.isAvailable,
});

const exposureContext: ToolExposureContext = {
  scope,
  agentId: "a1",
  execution,
};

describe("RuntimeToolRegistry", () => {
  it("registers and retrieves a tool by name", () => {
    const registry = new RuntimeToolRegistry();
    const tool = makeTool("alpha");
    registry.register(tool);
    expect(registry.get("alpha")).toBe(tool);
  });

  it("returns undefined for unknown tool via get", () => {
    const registry = new RuntimeToolRegistry();
    expect(registry.get("nope")).toBeUndefined();
  });

  it("throws when registering a duplicate name", () => {
    const registry = new RuntimeToolRegistry();
    registry.register(makeTool("dup"));
    expect(() => registry.register(makeTool("dup"))).toThrow("Tool is already registered: dup");
  });

  it("require throws for missing tool", () => {
    const registry = new RuntimeToolRegistry();
    expect(() => registry.require("missing")).toThrow("Tool is not registered: missing");
  });

  it("require returns tool when present", () => {
    const registry = new RuntimeToolRegistry();
    const tool = makeTool("exists");
    registry.register(tool);
    expect(registry.require("exists")).toBe(tool);
  });

  it("list returns all registered tools", () => {
    const a = makeTool("a");
    const b = makeTool("b");
    const registry = new RuntimeToolRegistry([a, b]);
    expect(registry.list()).toEqual([a, b]);
  });

  it("register returns this for chaining", () => {
    const registry = new RuntimeToolRegistry();
    const result = registry.register(makeTool("chain"));
    expect(result).toBe(registry);
  });
});

describe("createRuntimeToolRegistry", () => {
  it("creates a registry with provided tools", () => {
    const tool = makeTool("factory");
    const registry = createRuntimeToolRegistry([tool]);
    expect(registry.get("factory")).toBe(tool);
  });

  it("creates an empty registry when called with no args", () => {
    const registry = createRuntimeToolRegistry();
    expect(registry.list()).toEqual([]);
  });
});

describe("defaultToolExposureResolver", () => {
  it("marks all tools visible when no isAvailable is defined", async () => {
    const tools = [makeTool("t1"), makeTool("t2")];
    const decisions = await defaultToolExposureResolver(tools, exposureContext);
    expect(decisions).toHaveLength(2);
    expect(decisions.every((d) => d.visible)).toBe(true);
  });

  it("respects isAvailable returning false", async () => {
    const tool = makeTool("restricted", { isAvailable: () => false });
    const decisions = await defaultToolExposureResolver([tool], exposureContext);
    expect(decisions[0].visible).toBe(false);
    expect(decisions[0].reason).toMatch(/unavailable/i);
  });

  it("respects isAvailable returning true", async () => {
    const tool = makeTool("allowed", { isAvailable: () => true });
    const decisions = await defaultToolExposureResolver([tool], exposureContext);
    expect(decisions[0].visible).toBe(true);
    expect(decisions[0].reason).toMatch(/available/i);
  });
});

describe("resolveToolExposure", () => {
  it("uses defaultToolExposureResolver when none provided", async () => {
    const registry = createRuntimeToolRegistry([makeTool("x")]);
    const decisions = await resolveToolExposure(registry, exposureContext);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].visible).toBe(true);
  });

  it("uses a custom resolver when provided", async () => {
    const registry = createRuntimeToolRegistry([makeTool("x")]);
    const custom = async (tools: ToolDefinition[]) =>
      tools.map((tool) => ({ tool, visible: false, reason: "nope" }));
    const decisions = await resolveToolExposure(registry, exposureContext, custom);
    expect(decisions[0].visible).toBe(false);
  });
});

describe("getVisibleTools", () => {
  it("returns only tools marked visible", async () => {
    const visible = makeTool("vis", { isAvailable: () => true });
    const hidden = makeTool("hid", { isAvailable: () => false });
    const registry = createRuntimeToolRegistry([visible, hidden]);
    const result = await getVisibleTools(registry, exposureContext);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("vis");
  });
});

describe("executeRegisteredTool", () => {
  it("executes a registered tool and returns the result", async () => {
    const registry = createRuntimeToolRegistry([makeTool("exec")]);
    const ctx: ToolExecutionContext = { scope, execution };
    const result = await executeRegisteredTool<{ x: number }, { y: number }>(registry, {
      toolName: "exec",
      input: { x: 5 },
      context: ctx,
    });
    expect(result).toEqual({ ok: true, output: { y: 6 } });
  });

  it("throws when executing an unregistered tool", async () => {
    const registry = createRuntimeToolRegistry();
    const ctx: ToolExecutionContext = { scope, execution };
    await expect(
      executeRegisteredTool(registry, {
        toolName: "nope",
        input: {},
        context: ctx,
      }),
    ).rejects.toThrow("Tool is not registered: nope");
  });
});
