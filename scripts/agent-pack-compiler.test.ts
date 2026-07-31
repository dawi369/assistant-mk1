import { describe, expect, it } from "vitest";

import { loadAgentModules, validateLoadedModules } from "./agent-pack-compiler";

describe("agent pack compiler", () => {
  it("loads the configured modules and verifies complete bindings", async () => {
    const modules = await loadAgentModules(process.cwd());
    expect(modules.map((item) => item.manifest.id)).toEqual([
      "repo-analyst",
      "baby-polymancer",
      "baby-swordfish",
      "complex-operator",
    ]);
    expect(
      modules.every((item) => item.controlPlane.runtimeVersion === item.web.runtimeVersion),
    ).toBe(true);
  });

  it("rejects registry collisions", async () => {
    const modules = await loadAgentModules(process.cwd());
    const duplicate = {
      ...modules[1]!,
      manifest: { ...modules[1]!.manifest, id: modules[0]!.manifest.id },
    };
    expect(() => validateLoadedModules([modules[0]!, duplicate])).toThrow("Pack id");
  });

  it("rejects missing providers and incompatible runtimes", async () => {
    const modules = await loadAgentModules(process.cwd());
    const source = modules[3]!;
    const missing = {
      ...source,
      runner: { ...source.runner, tools: [] },
    };
    expect(() => validateLoadedModules([missing])).toThrow("missing runner binding");
    const incompatible = {
      ...source,
      controlPlane: { ...source.controlPlane, compatiblePackVersions: "^9.0.0" },
      runner: { ...source.runner, compatiblePackVersions: "^9.0.0" },
      web: { ...source.web, compatiblePackVersions: "^9.0.0" },
    };
    expect(() => validateLoadedModules([incompatible])).toThrow("incompatible");
  });

  it("requires Fly control-plane and runner contracts to match exactly", async () => {
    const modules = await loadAgentModules(process.cwd());
    const source = modules[0]!;
    const [firstRunnerTool, ...rest] = source.runner.tools;
    if (!firstRunnerTool) throw new Error("Repository Analyst must declare a runner tool.");
    const mismatch = {
      ...source,
      runner: {
        ...source.runner,
        tools: [
          { ...firstRunnerTool, maxArtifactBytes: firstRunnerTool.maxArtifactBytes + 1 },
          ...rest,
        ],
      },
    };
    expect(() => validateLoadedModules([mismatch])).toThrow("runner contract does not match");
  });

  it("rejects invalid schemas and unsupported execution modes", async () => {
    const modules = await loadAgentModules(process.cwd());
    const source = modules[3]!;
    const [firstTool, ...rest] = source.controlPlane.tools;
    if (!firstTool) throw new Error("Complex Operator must declare a tool.");
    const invalidSchema = {
      ...source,
      controlPlane: {
        ...source.controlPlane,
        tools: [{ ...firstTool, inputSchema: { type: "unsupported" } }, ...rest],
      },
    };
    expect(() => validateLoadedModules([invalidSchema])).toThrow("supported JSON Schema");

    const invalidMode = {
      ...source,
      controlPlane: {
        ...source.controlPlane,
        tools: [{ ...firstTool, executionModes: ["teleport"] }, ...rest],
      },
    };
    expect(() => validateLoadedModules([invalidMode as typeof source])).toThrow(
      "unsupported execution mode",
    );
  });
});
