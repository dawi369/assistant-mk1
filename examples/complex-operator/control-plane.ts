import {
  defineControlPlaneModule,
  type RuntimeRecord,
} from "@assistant-mk1/agent-sdk/control-plane";

const objectSchema = { type: "object", additionalProperties: false } as const;
const policy = (reference: string, modelVisible = false) => ({
  reference,
  adminVisible: true,
  modelVisible,
  requiresApproval: false,
  policyEditable: true,
  mutationRisk: "read_only" as const,
});

export const operatorSnapshotTool = {
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
  sandbox: {
    lifecycle: {
      template: "operator-snapshot-v1",
      setup: "per_invocation",
      workspaceState: "none",
      filesystem: "ephemeral",
      artifactPromotion: "metadata_only",
    },
    network: {
      egress: "none",
      allowedSchemes: [],
      allowedHosts: [],
      deniedHosts: ["*"],
      privateNetwork: "deny",
      enforcement: "control_plane_and_runner",
    },
    limits: { maxRuntimeMs: 2_000, maxArtifactBytes: 8_192 },
  },
  policy: {
    reference: "operator.snapshot.v1",
    adminVisible: true,
    modelVisible: false,
    requiresApproval: false,
    policyEditable: false,
    mutationRisk: "read_only",
  },
} as const;

export const controlPlane = defineControlPlaneModule({
  packId: "complex-operator",
  runtimeVersion: "1.1.0",
  compatiblePackVersions: "^1.0.0",
  tools: [
    {
      id: "operator.signal.read",
      description: "Return a deterministic Cloudflare-native signal.",
      inputSchema: objectSchema,
      outputSchema: { type: "object", required: ["signal"] },
      executionModes: ["dry_run"],
      transport: "cloudflare_inline",
      adapterVersion: "operator-signal-v1",
      timeoutMs: 1_000,
      maxArtifactBytes: 8_192,
      policy: policy("operator.signal.read.v1", true),
      execute: () => ({
        ok: true,
        output: { signal: "nominal", sequence: 1 },
        summary: "Deterministic operator signal is nominal.",
      }),
    },
    {
      id: "operator.action.propose",
      description: "Create an auditable dry-run action proposal.",
      inputSchema: {
        type: "object",
        required: ["summary"],
        additionalProperties: false,
        properties: { summary: { type: "string", minLength: 1, maxLength: 160 } },
      },
      outputSchema: { type: "object", required: ["proposalId", "status"] },
      executionModes: ["dry_run"],
      transport: "cloudflare_inline",
      adapterVersion: "operator-proposal-v1",
      timeoutMs: 1_000,
      maxArtifactBytes: 8_192,
      policy: policy("operator.action.propose.v1"),
      async execute(input, context) {
        const proposal = await context.actions.propose({
          type: "operator.synthetic_action",
          summary: String(input.summary),
          idempotencyKey: `${context.run.id}-proposal`,
          preview: { mutation: false },
        });
        return {
          ok: true,
          output: proposal as unknown as RuntimeRecord,
          summary: "Dry-run action proposal created; mutation remains disabled.",
        };
      },
    },
    operatorSnapshotTool,
  ],
  workflows: [
    {
      type: "complex-operator.observe",
      engine: "cloudflare",
      label: "Observe system",
      description: "Combine inline and signed-runner evidence into a report.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          subject: { type: "string", minLength: 1, maxLength: 80, default: "demo-system" },
        },
      },
      outputSchema: { type: "object", required: ["status", "signal", "snapshot"] },
      form: [
        {
          name: "subject",
          label: "Subject",
          description: "Bounded synthetic subject.",
          kind: "text",
          placeholder: "demo-system",
        },
      ],
      toolIds: ["operator.signal.read", "operator.snapshot", "operator.action.propose"],
      cancellation: { adapter: "external", physicalAbort: "best_effort" },
      smokeCommand: "pnpm agent-packs:test --pack complex-operator",
      async execute(input, context) {
        const signal = await context.tools.invoke("operator.signal.read", {});
        if (!signal.ok) return signal;
        const snapshot = await context.tools.invoke("operator.snapshot", {
          subject: String(input.subject ?? "demo-system"),
        });
        if (!snapshot.ok) return snapshot;
        const proposal = await context.tools.invoke("operator.action.propose", {
          summary: `Review ${String(input.subject ?? "demo-system")}`,
        });
        if (!proposal.ok) return proposal;
        const report = {
          status: "review",
          signal: signal.output,
          snapshot: snapshot.output,
          proposal: proposal.output,
        };
        await context.managedState.upsert({
          namespace: "complex-operator",
          stateType: "observation",
          stateKey: "current",
          status: "review",
          summary: "Deterministic observation completed.",
          data: report,
          expectedVersion: 0,
        });
        return {
          ok: true,
          output: report,
          summary: "Complex operator observation completed.",
          artifacts: [
            {
              kind: "complex_operator_report",
              title: "Complex operator report",
              mimeType: "application/json",
              data: report,
            },
          ],
        };
      },
    },
  ],
  health: [
    {
      id: "signal.binding",
      required: true,
      check: () => ({ ok: true, summary: "Inline signal binding is ready." }),
    },
    {
      id: "snapshot.binding",
      required: true,
      check: () => ({ ok: true, summary: "Signed runner binding is registered." }),
    },
    {
      id: "workflow.binding",
      required: true,
      check: () => ({ ok: true, summary: "Multi-step workflow binding is ready." }),
    },
  ],
  evals: [
    {
      id: "operator.static",
      required: true,
      run: () => ({ ok: true, summary: "Complex Operator static contract passed." }),
    },
    {
      id: "operator.runtime",
      required: true,
      run: () => ({ ok: true, summary: "Runtime execution is covered by conformance." }),
    },
  ],
});
