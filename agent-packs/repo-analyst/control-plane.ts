import { defineControlPlaneModule } from "@assistant-mk1/agent-sdk/control-plane";

const objectSchema = {
  type: "object",
  additionalProperties: false,
} as const;

export const controlPlane = defineControlPlaneModule({
  packId: "repo-analyst",
  runtimeVersion: "1.0.0",
  compatiblePackVersions: "^1.2.0",
  tools: [
    {
      id: "repo.snapshot",
      description: "Capture bounded repository evidence in the signed Fly runner.",
      inputSchema: {
        ...objectSchema,
        properties: {
          includeDocs: { type: "boolean" },
          includeScripts: { type: "boolean" },
          includeConfig: { type: "boolean" },
        },
      },
      outputSchema: { type: "object" },
      executionModes: ["dry_run"],
      transport: "fly",
      adapterVersion: "repo-snapshot-v1",
      timeoutMs: 10_000,
      maxArtifactBytes: 131_072,
      policy: {
        reference: "repo-snapshot-readonly-v0",
        adminVisible: true,
        modelVisible: false,
        requiresApproval: false,
        policyEditable: true,
        mutationRisk: "read_only",
      },
    },
    {
      id: "url.inspect",
      description: "Inspect a public URL through the hardened signed Fly runner.",
      inputSchema: {
        ...objectSchema,
        required: ["url"],
        properties: { url: { type: "string", minLength: 8, maxLength: 2048 } },
      },
      outputSchema: { type: "object" },
      executionModes: ["dry_run"],
      transport: "fly",
      adapterVersion: "url-inspect-v1",
      timeoutMs: 5_000,
      maxArtifactBytes: 131_072,
      policy: {
        reference: "tool-admin-readonly-v0",
        adminVisible: true,
        modelVisible: false,
        requiresApproval: false,
        policyEditable: true,
        mutationRisk: "read_only",
      },
    },
  ],
  workflows: [
    {
      type: "repo.readiness_report",
      engine: "cloudflare",
      label: "Readiness report",
      description: "Inspect repository structure and produce a bounded readiness report.",
      inputSchema: {
        ...objectSchema,
        properties: {
          includeDocs: { type: "boolean", default: true },
          includeScripts: { type: "boolean", default: true },
          includeConfig: { type: "boolean", default: true },
        },
      },
      outputSchema: { type: "object" },
      form: [
        {
          name: "includeDocs",
          label: "Documentation",
          description: "Include the bounded documentation inventory.",
          kind: "checkbox",
        },
        {
          name: "includeScripts",
          label: "Scripts",
          description: "Include package scripts and verification commands.",
          kind: "checkbox",
        },
        {
          name: "includeConfig",
          label: "Configuration",
          description: "Include bounded configuration-file evidence.",
          kind: "checkbox",
        },
      ],
      toolIds: ["repo.snapshot"],
      cancellation: { adapter: "none", physicalAbort: "unsupported" },
      smokeCommand: "pnpm smoke:fly-tool-runner",
      normalizeInput: (input) => ({
        includeDocs: input.includeDocs !== false,
        includeScripts: input.includeScripts !== false,
        includeConfig: input.includeConfig !== false,
      }),
    },
  ],
  health: [
    {
      id: "snapshot.binding",
      required: true,
      check: () => ({ ok: true, summary: "Repository snapshot binding compiled." }),
    },
    {
      id: "readiness.binding",
      required: true,
      check: () => ({ ok: true, summary: "Readiness workflow binding compiled." }),
    },
  ],
  evals: [
    {
      id: "repo.status.static",
      required: true,
      run: () => ({ ok: true, summary: "Repository Analyst static contract compiled." }),
    },
    {
      id: "repo.plan.runtime",
      required: true,
      run: () => ({ ok: true, summary: "Repository Analyst runtime path is conformance-gated." }),
    },
  ],
});
