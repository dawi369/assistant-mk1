import { describe, expect, it } from "vitest";

import { agentPackCheckSteps } from "./check-agent-pack";

describe("focused Agent Pack developer gate", () => {
  it("orders registry, contract, inspection, and runtime evidence", () => {
    expect(agentPackCheckSteps("polymancer", "/tmp/polymancer/control-plane.test.ts")).toEqual([
      { label: "compiled registry", script: "agent-packs:compile", args: [] },
      { label: "package contracts", script: "agent-packs:validate", args: [] },
      {
        label: "package characterization",
        script: "exec",
        args: ["vitest", "run", "/tmp/polymancer/control-plane.test.ts"],
      },
      {
        label: "runtime inspection",
        script: "agent-packs:inspect",
        args: ["--pack", "polymancer"],
      },
      {
        label: "health, eval, and workflow",
        script: "agent-packs:test",
        args: ["--pack", "polymancer"],
      },
    ]);
  });
});
