export type Level2Guarantee =
  | "scoped_identity"
  | "thread_continuity"
  | "typed_tool_policy"
  | "structured_results"
  | "audit_and_redaction"
  | "typed_workflow_intents"
  | "durable_runs_and_artifacts"
  | "approval_recovery"
  | "cancellation_authority"
  | "retry_lineage"
  | "agent_handoff"
  | "tenant_isolation";

export type Level2ConformanceSuite = {
  id: string;
  command: string;
  guarantees: Level2Guarantee[];
};

export const requiredLevel2Guarantees: Level2Guarantee[] = [
  "scoped_identity",
  "thread_continuity",
  "typed_tool_policy",
  "structured_results",
  "audit_and_redaction",
  "typed_workflow_intents",
  "durable_runs_and_artifacts",
  "approval_recovery",
  "cancellation_authority",
  "retry_lineage",
  "agent_handoff",
  "tenant_isolation",
];

export const level2ConformanceSuites: Level2ConformanceSuite[] = [
  {
    id: "level2-unit-contracts",
    command:
      "pnpm exec vitest run cloudflare/control-plane/src/workflow-callbacks.test.ts cloudflare/control-plane/src/run-control.test.ts cloudflare/control-plane/src/pack-workflow-lifecycle.test.ts cloudflare/control-plane/src/approval-transitions.test.ts cloudflare/control-plane/src/agent-connection-token.test.ts cloudflare/control-plane/src/membership-policy.test.ts",
    guarantees: [
      "scoped_identity",
      "typed_tool_policy",
      "audit_and_redaction",
      "typed_workflow_intents",
      "durable_runs_and_artifacts",
      "cancellation_authority",
      "retry_lineage",
      "agent_handoff",
    ],
  },
  {
    id: "signed-out-browser-boundary",
    command: "pnpm test:e2e:signed-out",
    guarantees: ["scoped_identity"],
  },
  {
    id: "local-release-browser-boundary",
    command: "pnpm test:e2e:local:release",
    guarantees: [
      "scoped_identity",
      "thread_continuity",
      "typed_tool_policy",
      "structured_results",
      "typed_workflow_intents",
      "durable_runs_and_artifacts",
    ],
  },
  {
    id: "level2-local-service-boundary",
    command: "pnpm test:service-boundaries:level2",
    guarantees: [
      "scoped_identity",
      "thread_continuity",
      "typed_tool_policy",
      "structured_results",
      "audit_and_redaction",
      "typed_workflow_intents",
      "durable_runs_and_artifacts",
      "approval_recovery",
      "cancellation_authority",
      "retry_lineage",
      "agent_handoff",
      "tenant_isolation",
    ],
  },
];

export const missingLevel2Guarantees = (executedSuiteIds?: Set<string>) => {
  const covered = new Set<Level2Guarantee>();
  for (const suite of level2ConformanceSuites) {
    if (executedSuiteIds && !executedSuiteIds.has(suite.id)) continue;
    for (const guarantee of suite.guarantees) covered.add(guarantee);
  }
  return requiredLevel2Guarantees.filter((guarantee) => !covered.has(guarantee));
};
