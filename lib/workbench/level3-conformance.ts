export type Level3Guarantee =
  | "forward_migrations"
  | "pack_api_v2"
  | "managed_state"
  | "trusted_triggers"
  | "schedule_timezone"
  | "webhook_auth_and_idempotency"
  | "leases_and_heartbeats"
  | "concurrency_limits"
  | "cancellation_authority"
  | "replay_lineage"
  | "lease_recovery"
  | "workflow_tool_policy"
  | "tenant_isolation"
  | "operator_visibility"
  | "operator_alerting"
  | "retained_data_lifecycle"
  | "agent_pack_scaffold"
  | "connection_contracts";

export type Level3ConformanceSuite = {
  id: string;
  command: string;
  guarantees: Level3Guarantee[];
};

export const requiredLevel3Guarantees: Level3Guarantee[] = [
  "forward_migrations",
  "pack_api_v2",
  "managed_state",
  "trusted_triggers",
  "schedule_timezone",
  "webhook_auth_and_idempotency",
  "leases_and_heartbeats",
  "concurrency_limits",
  "cancellation_authority",
  "replay_lineage",
  "lease_recovery",
  "workflow_tool_policy",
  "tenant_isolation",
  "operator_visibility",
  "operator_alerting",
  "retained_data_lifecycle",
  "agent_pack_scaffold",
  "connection_contracts",
];

export const level3ConformanceSuites: Level3ConformanceSuite[] = [
  {
    id: "level3-forward-migration-boundary",
    command: "pnpm db:cloudflare:migrations:verify && pnpm db:cloudflare:backup:verify",
    guarantees: ["forward_migrations", "retained_data_lifecycle"],
  },
  {
    id: "level3-unit-contracts",
    command:
      "pnpm exec vitest run agent-packs/dev-loop.test.ts lib/workbench/agent-pack-scaffold.test.ts lib/workbench/operator-alert-receiver.test.ts cloudflare/control-plane/src/connection-auth.test.ts cloudflare/control-plane/src/artifact-lifecycle.test.ts cloudflare/control-plane/src/workspace-data-lifecycle.test.ts cloudflare/control-plane/src/operator-alerts.test.ts cloudflare/control-plane/src/managed-state.test.ts cloudflare/control-plane/src/trigger-execution.test.ts cloudflare/control-plane/src/trigger-recovery.test.ts cloudflare/control-plane/src/trigger-schedule.test.ts cloudflare/control-plane/src/trigger-scheduler.test.ts cloudflare/control-plane/src/trigger-transitions.test.ts cloudflare/control-plane/src/trigger-webhook.test.ts cloudflare/control-plane/src/triggers.test.ts cloudflare/control-plane/src/workflow-tool-policy.test.ts",
    guarantees: [
      "pack_api_v2",
      "managed_state",
      "trusted_triggers",
      "schedule_timezone",
      "webhook_auth_and_idempotency",
      "leases_and_heartbeats",
      "concurrency_limits",
      "cancellation_authority",
      "replay_lineage",
      "lease_recovery",
      "workflow_tool_policy",
      "tenant_isolation",
      "operator_alerting",
      "retained_data_lifecycle",
      "agent_pack_scaffold",
      "connection_contracts",
    ],
  },
  {
    id: "level3-local-service-boundary",
    command: "pnpm test:service-boundaries:level3",
    guarantees: [
      "managed_state",
      "trusted_triggers",
      "schedule_timezone",
      "webhook_auth_and_idempotency",
      "leases_and_heartbeats",
      "concurrency_limits",
      "cancellation_authority",
      "replay_lineage",
      "lease_recovery",
      "workflow_tool_policy",
      "tenant_isolation",
      "operator_visibility",
    ],
  },
];

export const missingLevel3Guarantees = (executedSuiteIds?: Set<string>) => {
  const covered = new Set<Level3Guarantee>();
  for (const suite of level3ConformanceSuites) {
    if (executedSuiteIds && !executedSuiteIds.has(suite.id)) continue;
    for (const guarantee of suite.guarantees) covered.add(guarantee);
  }
  return requiredLevel3Guarantees.filter((guarantee) => !covered.has(guarantee));
};
