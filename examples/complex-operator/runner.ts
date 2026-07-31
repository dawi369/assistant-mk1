import { defineRunnerModule } from "@assistant-mk1/agent-sdk/runner";

export const runner = defineRunnerModule({
  packId: "complex-operator",
  runtimeVersion: "1.0.0",
  compatiblePackVersions: "^1.0.0",
  tools: [
    {
      id: "operator.snapshot",
      description: "Return a deterministic signed-runner snapshot.",
      inputSchema: {
        type: "object",
        required: ["subject"],
        additionalProperties: false,
        properties: { subject: { type: "string", minLength: 1, maxLength: 80 } },
      },
      outputSchema: { type: "object", required: ["subject", "observedAt", "status"] },
      executionModes: ["dry_run"],
      transport: "fly",
      adapterVersion: "operator-snapshot-v1",
      timeoutMs: 2_000,
      maxArtifactBytes: 8_192,
      sandbox: { network: "none", filesystem: "none" },
      policy: {
        reference: "operator.snapshot.v1",
        adminVisible: true,
        modelVisible: false,
        requiresApproval: false,
        policyEditable: false,
        mutationRisk: "read_only",
      },
      execute(input) {
        return {
          ok: true,
          output: {
            subject: String(input.subject),
            observedAt: "2026-01-01T00:00:00.000Z",
            status: "nominal",
          },
          summary: "Deterministic signed-runner snapshot completed.",
        };
      },
    },
  ],
});
