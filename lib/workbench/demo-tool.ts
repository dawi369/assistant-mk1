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
  description: "Inspect the trusted dev workspace and return a deterministic dry-run report.",
  kind: "native",
  timeoutMs: 1_000,
  execute: async (input, context) => ({
    ok: true,
    output: {
      inspectedTarget: input.target,
      checks: [
        {
          name: "tenant_scope",
          status: "pass",
          summary: `Trusted tenant scope was applied by runtime code for workspace ${context.scope.workspaceId}.`,
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
      summary: "Trusted dev workspace inspection completed without external mutation.",
    },
    auditSummary: "demo.inspect returned a deterministic dry-run report.",
  }),
};
