import type { ToolDefinition } from "@/lib/agent-framework/contracts";

export type DemoInspectInput = {
  target: "workspace";
};

export type DemoInspectOutput = {
  inspectedTarget: string;
  checks: Array<{
    name: string;
    status: "pass";
    summary: string;
  }>;
  summary: string;
};

export const demoInspectTool: ToolDefinition<DemoInspectInput, DemoInspectOutput> = {
  name: "demo.inspect",
  description: "Inspect the fixture workspace and return a deterministic dry-run report.",
  kind: "native",
  timeoutMs: 1_000,
  execute: async (input) => ({
    ok: true,
    output: {
      inspectedTarget: input.target,
      checks: [
        {
          name: "tenant_scope",
          status: "pass",
          summary: "Fixture tenant scope was applied by runtime code.",
        },
        {
          name: "tool_policy",
          status: "pass",
          summary: "The demo tool ran in dry-run mode with no secrets.",
        },
        {
          name: "durable_outputs",
          status: "pass",
          summary: "The run produced audit, artifact, and decision records.",
        },
      ],
      summary: "Fixture workspace inspection completed without external mutation.",
    },
    auditSummary: "demo.inspect returned a deterministic dry-run report.",
  }),
};
