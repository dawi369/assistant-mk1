import { describe, expect, it } from "vitest";

import {
  registerAgentPackSource,
  renderAgentPackIndex,
  renderAgentPackPrompt,
  renderAgentPackReadme,
  renderAgentPackTest,
  validateAgentPackScaffoldInput,
} from "./agent-pack-scaffold";

describe("Agent Pack scaffold", () => {
  it("renders a conservative Pack API v2 starter with matching prompt provenance", () => {
    const source = renderAgentPackIndex({ id: "trade-watcher", name: "Trade Watcher" });

    expect(source).toContain('id: "trade-watcher"');
    expect(source).toContain("externalMutation: false");
    expect(source).toContain('executionModes: ["dry_run"]');
    expect(source).toContain('minimumWorkbenchVersion: "1.0.0-preview.1"');
    expect(source).toContain(JSON.stringify(renderAgentPackPrompt("Trade Watcher")));
  });

  it("rejects unsafe identifiers and empty names before touching the filesystem", () => {
    expect(() => validateAgentPackScaffoldInput({ id: "Trade Watcher", name: "Trade" })).toThrow(
      "lowercase kebab-case",
    );
    expect(() => validateAgentPackScaffoldInput({ id: "trade-watcher", name: "" })).toThrow(
      "name is required",
    );
  });

  it("adds one package entry to workbench config and rejects duplicate registration", () => {
    const registry = `export default defineWorkbenchConfig({\n  runtimeApiVersion: 1,\n  modules: [\n  ],\n});\n`;
    const updated = registerAgentPackSource(registry, "trade-watcher");

    expect(updated).toContain('package: "@assistant-mk1/pack-trade-watcher"');
    expect(updated).toContain('source: "./agent-packs/trade-watcher"');
    expect(() => registerAgentPackSource(updated, "trade-watcher")).toThrow("already configured");
  });

  it("renders a self-documenting package with focused runtime characterization", () => {
    const input = { id: "trade-watcher", name: "Trade Watcher" };

    expect(renderAgentPackReadme(input)).toContain(
      "pnpm workbench pack check --pack trade-watcher",
    );
    expect(renderAgentPackReadme(input)).toContain("Package boundaries");
    expect(renderAgentPackTest(input)).toContain('expect(manifest.id).toBe("trade-watcher")');
    expect(renderAgentPackTest(input)).toContain("health.check()");
    expect(renderAgentPackTest(input)).toContain("evaluation.run()");
  });
});
