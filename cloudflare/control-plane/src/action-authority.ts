import {
  assertSchemaValue,
  type ActionExecutionResult,
  type ActionPort,
  type ActionProposal,
  type AgentPackConnectionDescriptor,
  type AgentExecutionContext,
  type RuntimeToolBinding,
  type RuntimeResult,
} from "@assistant-mk1/agent-sdk/control-plane";

import { resolvePackRuntime } from "../../../lib/agent-runtime/registry";
import { agentManifestRegistry } from "../../../generated/agent-runtime/manifests";
import { createBrokeredConnectionPort, issueFlyConnectionCapability } from "./connection-broker";
import { mutationsEnabled } from "./feature-gates";
import { isRecord, json, parseDataJson, parseJson } from "./http";
import { selectMembership } from "./authz-store";
import { requireAdminMembership } from "./membership-policy";
import { prepareOperatorAlertStatement } from "./operator-alerts";
import { evaluateToolPolicy, recordToolPolicyDecision } from "./tool-policy";
import {
  invokeFlyToolRunner,
  noEgressSandboxContract,
  runnerMetadataFor,
  type ToolRunnerSandboxContract,
} from "./tool-runner";
import {
  createId,
  toJson,
  type AgentIdentity,
  type ControlActionProposalRow,
  type ControlApprovalRequestRow,
  type Env,
} from "./types";

type RuntimeIdentity = {
  packId: string;
  packVersion: string;
  runtimeVersion: string;
  bindingVersion: number;
  runId: string;
  workflowIntentId: string;
  toolCallId?: string;
};

const terminalStatuses = new Set(["executed", "failed", "reconciled", "cancelled", "expired"]);

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
};

const sha256Hex = async (value: unknown) => {
  const bytes = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(stableValue(value))),
    ),
  );
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const proposalColumns = `id, user_id, workspace_id, agent_id, workflow_intent_id, run_id,
  tool_call_id, pack_id, pack_version, runtime_version, binding_version, tool_id, action_type,
  connection_record_id, status, summary, idempotency_key, input_sha256, proposal_json,
  policy_decision_id, approval_request_id, external_reference, result_json, error_json,
  version, created_at, updated_at, terminal_at`;

const selectProposal = (env: Env, identity: AgentIdentity, proposalId: string) =>
  env.DB.prepare(
    `SELECT ${proposalColumns} FROM control_action_proposals
     WHERE id = ? AND user_id = ? AND workspace_id = ? AND agent_id = ? LIMIT 1`,
  )
    .bind(proposalId, identity.scope.userId, identity.scope.workspaceId, identity.agentId)
    .first<ControlActionProposalRow>();

const appendLedgerStatement = (
  env: Env,
  identity: AgentIdentity,
  input: {
    proposalId: string;
    status: string;
    summary: string;
    requestSha256?: string | null;
    responseSha256?: string | null;
    externalReference?: string | null;
    data?: Record<string, unknown>;
    requiredStatus: string;
    requiredUpdatedAt?: string;
    timestamp: string;
  },
) =>
  env.DB.prepare(
    `INSERT INTO control_action_ledger (
       id, user_id, workspace_id, agent_id, proposal_id, sequence, status, summary,
       request_sha256, response_sha256, external_reference, data_json, created_at
     ) SELECT ?, ?, ?, ?, ?,
       COALESCE((SELECT MAX(sequence) FROM control_action_ledger WHERE proposal_id = ?), 0) + 1,
       ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM control_action_proposals
         WHERE id = ? AND status = ? AND (? IS NULL OR updated_at = ?)
       )`,
  ).bind(
    createId("cf-action-ledger"),
    identity.scope.userId,
    identity.scope.workspaceId,
    identity.agentId,
    input.proposalId,
    input.proposalId,
    input.status,
    input.summary,
    input.requestSha256 ?? null,
    input.responseSha256 ?? null,
    input.externalReference ?? null,
    toJson(input.data ?? {}),
    input.timestamp,
    input.proposalId,
    input.requiredStatus,
    input.requiredUpdatedAt ?? null,
    input.requiredUpdatedAt ?? null,
  );

const actionEvidenceStatements = (
  env: Env,
  identity: AgentIdentity,
  input: {
    proposalId: string;
    action: string;
    eventType: string;
    summary: string;
    status: string;
    timestamp: string;
    data?: Record<string, unknown>;
  },
) => [
  env.DB.prepare(
    `INSERT INTO control_audit_events (
       id, user_id, workspace_id, action, summary, target_type, target_id, data_json, created_at
     ) SELECT ?, ?, ?, ?, ?, 'actionProposal', ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM control_action_proposals
         WHERE id = ? AND status = ? AND updated_at = ?
       )`,
  ).bind(
    createId("cf-audit"),
    identity.scope.userId,
    identity.scope.workspaceId,
    input.action,
    input.summary,
    input.proposalId,
    toJson(input.data ?? {}),
    input.timestamp,
    input.proposalId,
    input.status,
    input.timestamp,
  ),
  env.DB.prepare(
    `INSERT INTO control_plane_events (
       id, user_id, workspace_id, agent_id, type, summary, target_type, target_id,
       data_json, created_at
     ) SELECT ?, ?, ?, ?, ?, ?, 'actionProposal', ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM control_action_proposals
         WHERE id = ? AND status = ? AND updated_at = ?
       )`,
  ).bind(
    createId("cf-event"),
    identity.scope.userId,
    identity.scope.workspaceId,
    identity.agentId,
    input.eventType,
    input.summary,
    input.proposalId,
    toJson(input.data ?? {}),
    input.timestamp,
    input.proposalId,
    input.status,
    input.timestamp,
  ),
];

const resolveBinding = (row: ControlActionProposalRow) => {
  const runtime = resolvePackRuntime(row.pack_id, row.pack_version);
  if (!runtime.runnable || runtime.runtimeVersion !== row.runtime_version) {
    throw Object.assign(new Error("The proposal runtime is no longer compatible."), {
      code: "runtime_incompatible",
    });
  }
  const binding = runtime.controlPlane.tools.find((tool) => tool.id === row.tool_id) as
    | RuntimeToolBinding
    | undefined;
  if (!binding?.action) {
    throw Object.assign(new Error("The proposal action binding is unavailable."), {
      code: "action_binding_unavailable",
    });
  }
  return { runtime, binding };
};

const manifestConnections = (packId: string): readonly AgentPackConnectionDescriptor[] => {
  const entry = agentManifestRegistry[packId as keyof typeof agentManifestRegistry];
  return entry?.module.connections ?? [];
};

const mutationPreflight = async (
  env: Env,
  identity: AgentIdentity,
  row: ControlActionProposalRow,
) => {
  if (!mutationsEnabled(env))
    throw Object.assign(new Error("External mutation is disabled."), { code: "mutation_disabled" });
  const policy = await env.DB.prepare(
    `SELECT confirmed_at FROM control_retention_policies
     WHERE workspace_id = ? LIMIT 1`,
  )
    .bind(identity.scope.workspaceId)
    .first<{ confirmed_at: string | null }>();
  if (!policy?.confirmed_at)
    throw Object.assign(new Error("Confirm workspace retention before mutation."), {
      code: "retention_confirmation_required",
    });
  const permission = await env.DB.prepare(
    `SELECT data_json FROM tool_permissions
     WHERE user_id = ? AND workspace_id = ? AND agent_id = ? AND tool_id = ? LIMIT 1`,
  )
    .bind(identity.scope.userId, identity.scope.workspaceId, identity.agentId, row.tool_id)
    .first<{ data_json: string }>();
  if (parseDataJson(permission?.data_json ?? "{}").mutationEnabled !== true) {
    throw Object.assign(
      new Error("Enable mutation for this tool in workspace policy before execution."),
      { code: "workspace_mutation_not_enabled" },
    );
  }
  const blocked = await env.DB.prepare(
    `SELECT scope_kind, scope_id, reason FROM control_kill_switches
     WHERE user_id = ? AND workspace_id = ? AND enabled = 1 AND (
       (scope_kind = 'workspace' AND scope_id = ?) OR
       (scope_kind = 'pack' AND scope_id = ?) OR
       (scope_kind = 'tool' AND scope_id = ?) OR
       (scope_kind = 'connection' AND scope_id IN (
         ?,
         COALESCE((SELECT connection_id FROM control_connections WHERE id = ?), '')
       ))
     ) ORDER BY CASE scope_kind WHEN 'workspace' THEN 0 WHEN 'pack' THEN 1 WHEN 'tool' THEN 2 ELSE 3 END
     LIMIT 1`,
  )
    .bind(
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.scope.workspaceId,
      row.pack_id,
      row.tool_id,
      row.connection_record_id ?? "",
      row.connection_record_id ?? "",
    )
    .first<{ scope_kind: string; scope_id: string; reason: string }>();
  if (blocked)
    throw Object.assign(new Error("Mutation blocked by an operator kill switch."), {
      code: "kill_switch_active",
      data: { scopeKind: blocked.scope_kind, scopeId: blocked.scope_id },
    });
  if (row.connection_record_id) {
    const connection = await env.DB.prepare(
      `SELECT status FROM control_connections WHERE id = ? AND user_id = ? AND workspace_id = ? LIMIT 1`,
    )
      .bind(row.connection_record_id, identity.scope.userId, identity.scope.workspaceId)
      .first<{ status: string }>();
    if (connection?.status !== "authorized")
      throw Object.assign(new Error("The required connection is not authorized."), {
        code: "connection_not_authorized",
      });
  }
  const { binding } = resolveBinding(row);
  if (binding.action?.connectionId && !row.connection_record_id) {
    throw Object.assign(new Error("The required connection is not authorized."), {
      code: "connection_not_authorized",
    });
  }
};

const evaluateActionPolicy = async (
  env: Env,
  identity: AgentIdentity,
  row: ControlActionProposalRow,
  surface: "admin_run" | "admin_resume",
) => {
  const membership = await selectMembership(env, identity.scope.userId, identity.scope.workspaceId);
  const result = await evaluateToolPolicy(env, identity, {
    membership,
    toolName: row.tool_id,
    executionMode: "execute",
    surface,
  });
  const decisionId = await recordToolPolicyDecision(env, identity, {
    toolName: row.tool_id,
    surface,
    result,
    data: { source: "action_authority", proposalId: row.id },
  });
  return { result, decisionId };
};

const executionContext = (
  env: Env,
  identity: AgentIdentity,
  row: ControlActionProposalRow,
  connections: readonly AgentPackConnectionDescriptor[],
): AgentExecutionContext => ({
  scope: { ...identity.scope, agentId: identity.agentId },
  pack: { id: row.pack_id, version: row.pack_version, runtimeVersion: row.runtime_version },
  run: {
    id: row.run_id,
    workflowIntentId: row.workflow_intent_id,
    executionMode: "execute",
    source: "user",
  },
  signal: new AbortController().signal,
  connections: createBrokeredConnectionPort(env, identity, connections),
  actions: {
    async propose() {
      throw Object.assign(new Error("Nested action proposals are disabled."), {
        code: "nested_action_disabled",
      });
    },
    async execute() {
      throw Object.assign(new Error("Nested action execution is disabled."), {
        code: "nested_action_disabled",
      });
    },
  },
  tools: {
    async invoke() {
      throw Object.assign(new Error("Action executors cannot invoke tools."), {
        code: "nested_tool_invocation_disabled",
      });
    },
  },
  managedState: {
    async upsert() {
      throw Object.assign(new Error("Action executors cannot write managed state directly."), {
        code: "managed_state_write_disabled",
      });
    },
  },
  events: { async append() {} },
});

const dispatchAction = async (
  env: Env,
  identity: AgentIdentity,
  row: ControlActionProposalRow,
  binding: RuntimeToolBinding,
  proposal: ActionProposal,
): Promise<ActionExecutionResult> => {
  if (binding.transport === "cloudflare_inline") {
    return binding.action!.execute(
      proposal,
      executionContext(env, identity, row, manifestConnections(row.pack_id)),
    );
  }
  const runner = runnerMetadataFor(
    {
      toolName: binding.id,
      adapterVersion: binding.adapterVersion,
      supportedExecutionModes: [...binding.executionModes],
      transport: "fly",
    },
    "agent-pack",
    "fly",
    (binding.sandbox as ToolRunnerSandboxContract | undefined) ??
      noEgressSandboxContract({
        template: binding.adapterVersion,
        maxRuntimeMs: binding.action!.timeoutMs,
        maxArtifactBytes: binding.maxArtifactBytes,
      }),
  );
  const connectionCapability =
    binding.action!.connectionId && row.connection_record_id
      ? await issueFlyConnectionCapability(env, identity, {
          connectionRecordId: row.connection_record_id,
          connectionId: binding.action!.connectionId,
          runId: row.run_id,
          workflowIntentId: row.workflow_intent_id,
          toolCallId: row.tool_call_id ?? `action:${row.id}`,
          toolId: binding.id,
          timeoutMs: binding.action!.timeoutMs,
        })
      : undefined;
  const result = await invokeFlyToolRunner(env, identity, {
    scope: identity.scope,
    agentId: identity.agentId,
    runId: row.run_id,
    workflowIntentId: row.workflow_intent_id,
    toolCallId: row.tool_call_id ?? `action:${row.id}`,
    packVersion: row.pack_version,
    runtimeVersion: row.runtime_version,
    bindingVersion: row.binding_version,
    toolName: binding.id,
    execution: { mode: "execute", policy: binding.policy.reference },
    input: {
      summary: proposal.summary,
      idempotencyKey: proposal.idempotencyKey,
      preview: proposal.preview,
    },
    runner,
    connectionCapability,
    policyDecisionId: row.policy_decision_id ?? undefined,
    source: "agent-pack",
  });
  const runtimeResult = result as RuntimeResult;
  if (!runtimeResult.ok) {
    return {
      proposalId: row.id,
      status: "failed",
      summary: runtimeResult.summary,
    };
  }
  const output = runtimeResult.output;
  const status = output.status === "outcome_unknown" ? "outcome_unknown" : "executed";
  return {
    proposalId: row.id,
    status,
    summary: runtimeResult.summary,
    externalReference:
      typeof output.externalReference === "string" ? output.externalReference : undefined,
    output,
  };
};

export const createDurableActionPort = (
  env: Env,
  identity: AgentIdentity,
  runtimeIdentity: RuntimeIdentity,
): ActionPort => ({
  async propose(proposal) {
    if (
      proposal.summary.trim().length === 0 ||
      proposal.summary.length > 240 ||
      proposal.idempotencyKey.length > 200
    ) {
      throw Object.assign(new Error("Action proposal is invalid."), {
        code: "action_proposal_invalid",
      });
    }
    const runtime = resolvePackRuntime(runtimeIdentity.packId, runtimeIdentity.packVersion);
    if (!runtime.runnable || runtime.runtimeVersion !== runtimeIdentity.runtimeVersion) {
      throw Object.assign(new Error("Action runtime is incompatible."), {
        code: "runtime_incompatible",
      });
    }
    const binding = runtime.controlPlane.tools.find((tool) => tool.id === proposal.toolId) as
      | RuntimeToolBinding
      | undefined;
    if (!binding?.action)
      throw Object.assign(new Error("Action binding is unavailable."), {
        code: "action_binding_unavailable",
      });
    assertSchemaValue(
      binding.action.proposalSchema,
      proposal.preview,
      `${proposal.toolId} action proposal`,
    );
    const descriptor = binding.action.connectionId
      ? manifestConnections(runtimeIdentity.packId).find(
          (candidate) => candidate.id === binding.action?.connectionId,
        )
      : undefined;
    const connection = descriptor
      ? await env.DB.prepare(
          `SELECT id FROM control_connections
           WHERE user_id = ? AND workspace_id = ? AND agent_id = ? AND pack_id = ?
             AND connection_id = ? AND status = 'authorized' LIMIT 1`,
        )
          .bind(
            identity.scope.userId,
            identity.scope.workspaceId,
            identity.agentId,
            runtimeIdentity.packId,
            descriptor.id,
          )
          .first<{ id: string }>()
      : null;
    const id = createId("cf-action");
    const timestamp = new Date().toISOString();
    const inputSha256 = await sha256Hex(proposal.preview);
    const result = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO control_action_proposals (
           id, user_id, workspace_id, agent_id, workflow_intent_id, run_id, tool_call_id,
           pack_id, pack_version, runtime_version, binding_version, tool_id, action_type,
           connection_record_id, status, summary, idempotency_key, input_sha256, proposal_json,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, workspace_id, tool_id, idempotency_key) DO NOTHING`,
      ).bind(
        id,
        identity.scope.userId,
        identity.scope.workspaceId,
        identity.agentId,
        runtimeIdentity.workflowIntentId,
        runtimeIdentity.runId,
        runtimeIdentity.toolCallId ?? null,
        runtimeIdentity.packId,
        runtimeIdentity.packVersion,
        runtimeIdentity.runtimeVersion,
        runtimeIdentity.bindingVersion,
        proposal.toolId,
        proposal.type,
        connection?.id ?? null,
        proposal.summary,
        proposal.idempotencyKey,
        inputSha256,
        toJson(proposal),
        timestamp,
        timestamp,
      ),
      appendLedgerStatement(env, identity, {
        proposalId: id,
        status: "proposed",
        summary: proposal.summary,
        requestSha256: inputSha256,
        requiredStatus: "proposed",
        requiredUpdatedAt: timestamp,
        timestamp,
      }),
      ...actionEvidenceStatements(env, identity, {
        proposalId: id,
        action: "action.proposed",
        eventType: "action.proposed",
        summary: proposal.summary,
        status: "proposed",
        timestamp,
        data: { toolId: proposal.toolId, actionType: proposal.type },
      }),
    ]);
    if ((result[0]?.meta?.changes ?? 0) === 0) {
      const existing = await env.DB.prepare(
        `SELECT id, status FROM control_action_proposals
         WHERE user_id = ? AND workspace_id = ? AND tool_id = ? AND idempotency_key = ? LIMIT 1`,
      )
        .bind(
          identity.scope.userId,
          identity.scope.workspaceId,
          proposal.toolId,
          proposal.idempotencyKey,
        )
        .first<{ id: string; status: string }>();
      if (!existing) throw new Error("action_proposal_conflict");
      return { proposalId: existing.id, status: "proposed" };
    }
    return { proposalId: id, status: "proposed" };
  },
  async execute(proposalId) {
    return executeActionProposal(env, identity, proposalId);
  },
  async reconcile(proposalId) {
    return reconcileActionProposal(env, identity, proposalId);
  },
});

export const executeActionProposal = async (
  env: Env,
  identity: AgentIdentity,
  proposalId: string,
): Promise<ActionExecutionResult> => {
  const row = await selectProposal(env, identity, proposalId);
  if (!row)
    throw Object.assign(new Error("Action proposal not found."), { code: "action_not_found" });
  if (row.status !== "approved")
    throw Object.assign(new Error("Action proposal is not approved."), {
      code: terminalStatuses.has(row.status) ? "action_terminal" : "action_approval_required",
    });
  await mutationPreflight(env, identity, row);
  const policy = await evaluateActionPolicy(env, identity, row, "admin_resume");
  if (policy.result.decision === "block") {
    throw Object.assign(new Error(policy.result.reason), { code: policy.result.code });
  }
  const { binding } = resolveBinding(row);
  const proposal = parseJson(row.proposal_json) as ActionProposal;
  assertSchemaValue(
    binding.action!.proposalSchema,
    proposal.preview,
    `${row.tool_id} action proposal`,
  );
  const timestamp = new Date().toISOString();
  const claimed = await env.DB.batch([
    env.DB.prepare(
      `UPDATE control_action_proposals SET status = 'executing', version = version + 1, updated_at = ?
       WHERE id = ? AND user_id = ? AND workspace_id = ? AND status = 'approved' AND version = ?`,
    ).bind(timestamp, row.id, identity.scope.userId, identity.scope.workspaceId, row.version),
    appendLedgerStatement(env, identity, {
      proposalId: row.id,
      status: "executing",
      requiredStatus: "executing",
      requiredUpdatedAt: timestamp,
      summary: "Action execution started.",
      requestSha256: row.input_sha256,
      timestamp,
    }),
  ]);
  if ((claimed[0]?.meta?.changes ?? 0) === 0)
    throw Object.assign(new Error("Action proposal is already being handled."), {
      code: "action_conflict",
    });

  let result: ActionExecutionResult;
  try {
    result = await Promise.race([
      dispatchAction(env, identity, row, binding, proposal),
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              Object.assign(new Error("Action outcome is unknown after timeout."), {
                code: "action_timeout",
              }),
            ),
          binding.action!.timeoutMs,
        ),
      ),
    ]);
    assertSchemaValue(
      binding.action!.resultSchema,
      result.output ?? {},
      `${row.tool_id} action result`,
    );
  } catch (error) {
    result = {
      proposalId: row.id,
      status:
        error && typeof error === "object" && "code" in error && error.code === "action_timeout"
          ? "outcome_unknown"
          : "failed",
      summary: error instanceof Error ? error.message : "Action execution failed.",
    };
  }
  const finishedAt = new Date().toISOString();
  const responseSha256 = await sha256Hex(
    result.output ?? { status: result.status, summary: result.summary },
  );
  const published = await env.DB.batch([
    env.DB.prepare(
      `UPDATE control_action_proposals SET status = ?, external_reference = ?, result_json = ?,
         error_json = ?, version = version + 1, terminal_at = CASE WHEN ? = 'outcome_unknown' THEN NULL ELSE ? END,
         updated_at = ? WHERE id = ? AND user_id = ? AND workspace_id = ? AND status = 'executing'
         AND EXISTS (
           SELECT 1 FROM control_runs WHERE id = control_action_proposals.run_id
             AND user_id = ? AND workspace_id = ? AND status = 'running'
         )`,
    ).bind(
      result.status,
      result.externalReference ?? null,
      toJson(result.output ?? {}),
      result.status === "failed" || result.status === "outcome_unknown"
        ? toJson({ code: result.status, summary: result.summary })
        : "{}",
      result.status,
      finishedAt,
      finishedAt,
      row.id,
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.scope.userId,
      identity.scope.workspaceId,
    ),
    appendLedgerStatement(env, identity, {
      proposalId: row.id,
      status: result.status,
      summary: result.summary,
      requestSha256: row.input_sha256,
      responseSha256,
      externalReference: result.externalReference,
      requiredStatus: result.status,
      requiredUpdatedAt: finishedAt,
      timestamp: finishedAt,
    }),
    ...actionEvidenceStatements(env, identity, {
      proposalId: row.id,
      action: `action.${result.status}`,
      eventType: `action.${result.status}`,
      summary: result.summary,
      status: result.status,
      timestamp: finishedAt,
      data: { toolId: row.tool_id, packId: row.pack_id },
    }),
    ...(result.status === "outcome_unknown"
      ? [
          prepareOperatorAlertStatement(env, {
            userId: identity.scope.userId,
            workspaceId: identity.scope.workspaceId,
            agentId: identity.agentId,
            severity: "critical",
            code: "action_outcome_unknown",
            summary:
              "An external mutation has an ambiguous provider outcome and requires reconciliation.",
            targetType: "actionProposal",
            targetId: row.id,
            dedupKey: `action-outcome-unknown:${row.id}`,
            data: { toolId: row.tool_id, packId: row.pack_id },
            timestamp: finishedAt,
            conditionSql:
              "EXISTS (SELECT 1 FROM control_action_proposals WHERE id = ? AND status = 'outcome_unknown' AND updated_at = ?)",
            conditionBindings: [row.id, finishedAt],
          }),
        ]
      : []),
  ]);
  if ((published[0]?.meta?.changes ?? 0) === 0) {
    const revokedAt = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE control_action_proposals SET status = 'outcome_unknown', error_json = ?,
           version = version + 1, updated_at = ?
         WHERE id = ? AND user_id = ? AND workspace_id = ? AND status = 'executing'`,
      ).bind(
        toJson({
          code: "publication_revoked",
          summary: "Execution completed after cancellation; reconcile before retry.",
        }),
        revokedAt,
        row.id,
        identity.scope.userId,
        identity.scope.workspaceId,
      ),
      appendLedgerStatement(env, identity, {
        proposalId: row.id,
        status: "outcome_unknown",
        requiredStatus: "outcome_unknown",
        requiredUpdatedAt: revokedAt,
        summary: "Action result publication was revoked after dispatch.",
        requestSha256: row.input_sha256,
        timestamp: revokedAt,
      }),
      ...actionEvidenceStatements(env, identity, {
        proposalId: row.id,
        action: "action.outcome_unknown",
        eventType: "action.outcome_unknown",
        summary: "Action result publication was revoked after dispatch.",
        status: "outcome_unknown",
        timestamp: revokedAt,
        data: { toolId: row.tool_id, packId: row.pack_id, publicationRevoked: true },
      }),
      prepareOperatorAlertStatement(env, {
        userId: identity.scope.userId,
        workspaceId: identity.scope.workspaceId,
        agentId: identity.agentId,
        severity: "critical",
        code: "action_outcome_unknown",
        summary:
          "An external mutation completed after publication authority was revoked; reconcile before retry.",
        targetType: "actionProposal",
        targetId: row.id,
        dedupKey: `action-outcome-unknown:${row.id}`,
        data: { toolId: row.tool_id, packId: row.pack_id, publicationRevoked: true },
        timestamp: revokedAt,
        conditionSql:
          "EXISTS (SELECT 1 FROM control_action_proposals WHERE id = ? AND status = 'outcome_unknown' AND updated_at = ?)",
        conditionBindings: [row.id, revokedAt],
      }),
    ]);
    return {
      proposalId: row.id,
      status: "outcome_unknown",
      summary: "Execution completed after cancellation; reconcile before retry.",
    };
  }
  return { ...result, proposalId: row.id };
};

export const reconcileActionProposal = async (
  env: Env,
  identity: AgentIdentity,
  proposalId: string,
): Promise<ActionExecutionResult> => {
  const row = await selectProposal(env, identity, proposalId);
  if (!row)
    throw Object.assign(new Error("Action proposal not found."), { code: "action_not_found" });
  if (row.status !== "outcome_unknown")
    throw Object.assign(new Error("Only unknown outcomes can be reconciled."), {
      code: "reconciliation_not_required",
    });
  const { binding } = resolveBinding(row);
  if (!binding.action?.reconcile)
    throw Object.assign(new Error("Action binding does not support reconciliation."), {
      code: "reconciliation_unavailable",
    });
  const proposal = parseJson(row.proposal_json) as ActionProposal;
  const result = await binding.action.reconcile(
    proposal,
    executionContext(env, identity, row, manifestConnections(row.pack_id)),
  );
  const timestamp = new Date().toISOString();
  if (result.status !== "reconciled" && result.status !== "executed") {
    await env.DB.batch([
      appendLedgerStatement(env, identity, {
        proposalId: row.id,
        status: "reviewed",
        requiredStatus: "outcome_unknown",
        summary: result.summary,
        externalReference: result.externalReference,
        timestamp,
      }),
      ...actionEvidenceStatements(env, identity, {
        proposalId: row.id,
        action: "action.reviewed",
        eventType: "action.reviewed",
        summary: result.summary,
        status: "outcome_unknown",
        timestamp,
        data: { toolId: row.tool_id, packId: row.pack_id },
      }),
    ]);
    return { ...result, proposalId: row.id, status: "outcome_unknown" };
  }
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE control_action_proposals SET status = 'reconciled', external_reference = ?, result_json = ?,
         error_json = '{}', version = version + 1, terminal_at = ?, updated_at = ?
       WHERE id = ? AND user_id = ? AND workspace_id = ? AND status = 'outcome_unknown'`,
    ).bind(
      result.externalReference ?? null,
      toJson(result.output ?? {}),
      timestamp,
      timestamp,
      row.id,
      identity.scope.userId,
      identity.scope.workspaceId,
    ),
    appendLedgerStatement(env, identity, {
      proposalId: row.id,
      status: "reconciled",
      requiredStatus: "reconciled",
      requiredUpdatedAt: timestamp,
      summary: result.summary,
      externalReference: result.externalReference,
      timestamp,
    }),
    ...actionEvidenceStatements(env, identity, {
      proposalId: row.id,
      action: "action.reconciled",
      eventType: "action.reconciled",
      summary: result.summary,
      status: "reconciled",
      timestamp,
      data: { toolId: row.tool_id, packId: row.pack_id },
    }),
  ]);
  return { ...result, proposalId: row.id, status: "reconciled" };
};

export const handleListActionProposals = async (env: Env, identity: AgentIdentity, url: URL) => {
  const requested = Number(url.searchParams.get("limit") ?? 25);
  const limit = Math.max(1, Math.min(100, Number.isFinite(requested) ? requested : 25));
  const rows = await env.DB.prepare(
    `SELECT ${proposalColumns} FROM control_action_proposals
     WHERE user_id = ? AND workspace_id = ? AND agent_id = ? ORDER BY created_at DESC LIMIT ?`,
  )
    .bind(identity.scope.userId, identity.scope.workspaceId, identity.agentId, limit)
    .all<ControlActionProposalRow>();
  const proposalIds = rows.results.map((row) => row.id);
  const ledger = proposalIds.length
    ? await env.DB.prepare(
        `SELECT proposal_id, sequence, status, summary, external_reference, created_at
         FROM control_action_ledger
         WHERE user_id = ? AND workspace_id = ? AND agent_id = ?
           AND proposal_id IN (${proposalIds.map(() => "?").join(", ")})
         ORDER BY proposal_id, sequence ASC`,
      )
        .bind(identity.scope.userId, identity.scope.workspaceId, identity.agentId, ...proposalIds)
        .all<{
          proposal_id: string;
          sequence: number;
          status: string;
          summary: string;
          external_reference: string | null;
          created_at: string;
        }>()
    : { results: [] };
  return json({
    ok: true,
    proposals: rows.results.map((row) => ({
      id: row.id,
      toolId: row.tool_id,
      actionType: row.action_type,
      status: row.status,
      summary: row.summary,
      externalReference: row.external_reference,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      terminalAt: row.terminal_at,
      ledger: ledger.results
        .filter((entry) => entry.proposal_id === row.id)
        .map((entry) => ({
          sequence: entry.sequence,
          status: entry.status,
          summary: entry.summary,
          externalReference: entry.external_reference,
          createdAt: entry.created_at,
        })),
    })),
  });
};

export const handleRequestActionExecution = async (
  env: Env,
  identity: AgentIdentity,
  proposalId: string,
) => {
  const membership = await selectMembership(env, identity.scope.userId, identity.scope.workspaceId);
  const adminError = requireAdminMembership(membership);
  if (adminError) return adminError;
  const row = await selectProposal(env, identity, proposalId);
  if (!row) return json({ ok: false, error: "Action proposal not found." }, { status: 404 });
  if (row.status !== "proposed")
    return json(
      { ok: false, code: "action_conflict", error: "Only proposed actions can request execution." },
      { status: 409 },
    );
  try {
    await mutationPreflight(env, identity, row);
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "mutation_blocked";
    const timestamp = new Date().toISOString();
    await prepareOperatorAlertStatement(env, {
      userId: identity.scope.userId,
      workspaceId: identity.scope.workspaceId,
      agentId: identity.agentId,
      severity: "warning",
      code: "mutation_blocked",
      summary: "A requested external mutation was blocked by authority policy.",
      targetType: "actionProposal",
      targetId: row.id,
      dedupKey: `mutation-blocked:${row.id}:${code}`,
      data: { code, toolId: row.tool_id, packId: row.pack_id },
      timestamp,
    }).run();
    return json(
      {
        ok: false,
        code:
          error && typeof error === "object" && "code" in error ? error.code : "mutation_blocked",
        error: error instanceof Error ? error.message : "Mutation blocked.",
      },
      { status: 403 },
    );
  }
  const policy = await evaluateActionPolicy(env, identity, row, "admin_run");
  if (policy.result.decision === "block" && policy.result.code !== "approval_required") {
    return json(
      { ok: false, code: policy.result.code, error: policy.result.reason },
      { status: policy.result.status },
    );
  }
  const approvalId = createId("cf-approval");
  const intentId = createId("cf-intent");
  const runId = createId("cf-run");
  const timestamp = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE control_action_proposals SET status = 'approval_requested', approval_request_id = ?,
         policy_decision_id = ?, run_id = ?, workflow_intent_id = ?, version = version + 1,
         updated_at = ?
       WHERE id = ? AND user_id = ? AND workspace_id = ? AND status = 'proposed'`,
    ).bind(
      approvalId,
      policy.decisionId,
      runId,
      intentId,
      timestamp,
      row.id,
      identity.scope.userId,
      identity.scope.workspaceId,
    ),
    env.DB.prepare(
      `INSERT INTO control_workflow_intents (id, user_id, workspace_id, agent_id, stage, type,
         execution_json, payload_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'act', ?, ?, ?, 'interrupted', ?, ?)`,
    ).bind(
      intentId,
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.agentId,
      `action.${row.action_type}`,
      toJson({ mode: "execute" }),
      toJson({ actionProposalId: row.id }),
      timestamp,
      timestamp,
    ),
    env.DB.prepare(
      `INSERT INTO control_runs (id, user_id, workspace_id, agent_id, workflow_intent_id, status,
         execution_json, stage, engine, heartbeat_at, last_event_at, data_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'interrupted', ?, 'act', 'cloudflare', ?, ?, ?, ?, ?)`,
    ).bind(
      runId,
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.agentId,
      intentId,
      toJson({ mode: "execute" }),
      timestamp,
      timestamp,
      toJson({
        displayName: row.summary,
        actionProposalId: row.id,
        summary: "Action approval required.",
      }),
      timestamp,
      timestamp,
    ),
    env.DB.prepare(
      `INSERT INTO control_approval_requests (id, user_id, workspace_id, agent_id, workflow_intent_id,
         run_id, tool_id, status, reason, data_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'requested', 'External mutation requires approval.', ?, ?, ?)`,
    ).bind(
      approvalId,
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.agentId,
      intentId,
      runId,
      row.tool_id,
      toJson({ actionProposalId: row.id, source: "action_authority" }),
      timestamp,
      timestamp,
    ),
    appendLedgerStatement(env, identity, {
      proposalId: row.id,
      status: "blocked",
      requiredStatus: "approval_requested",
      requiredUpdatedAt: timestamp,
      summary: "Action is waiting for approval.",
      timestamp,
    }),
    ...actionEvidenceStatements(env, identity, {
      proposalId: row.id,
      action: "action.approval_requested",
      eventType: "action.approval.requested",
      summary: "External mutation is waiting for workspace approval.",
      status: "approval_requested",
      timestamp,
      data: { approvalRequestId: approvalId, runId },
    }),
  ]);
  return json(
    {
      ok: false,
      code: "approval_required",
      proposalId: row.id,
      approvalRequest: { id: approvalId, status: "requested" },
      run: { id: runId, workflowIntentId: intentId, status: "interrupted" },
    },
    { status: 202 },
  );
};

export const approveAndExecuteActionApproval = async (
  env: Env,
  identity: AgentIdentity,
  approval: ControlApprovalRequestRow,
) => {
  const data = parseDataJson(approval.data_json);
  const proposalId = typeof data.actionProposalId === "string" ? data.actionProposalId : "";
  const row = proposalId ? await selectProposal(env, identity, proposalId) : null;
  if (!row || row.status !== "approval_requested" || row.approval_request_id !== approval.id) {
    return json(
      { ok: false, code: "action_conflict", error: "Action approval is no longer active." },
      { status: 409 },
    );
  }
  const timestamp = new Date().toISOString();
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE control_approval_requests SET status = 'approved', updated_at = ?
       WHERE id = ? AND user_id = ? AND workspace_id = ? AND status = 'requested'`,
    ).bind(timestamp, approval.id, identity.scope.userId, identity.scope.workspaceId),
    env.DB.prepare(
      `UPDATE control_action_proposals SET status = 'approved', version = version + 1, updated_at = ?
       WHERE id = ? AND user_id = ? AND workspace_id = ? AND status = 'approval_requested'`,
    ).bind(timestamp, row.id, identity.scope.userId, identity.scope.workspaceId),
    env.DB.prepare(
      `UPDATE control_runs SET status = 'running', heartbeat_at = ?, last_event_at = ?, updated_at = ?
       WHERE id = ? AND user_id = ? AND workspace_id = ? AND status = 'interrupted'`,
    ).bind(
      timestamp,
      timestamp,
      timestamp,
      approval.run_id,
      identity.scope.userId,
      identity.scope.workspaceId,
    ),
    env.DB.prepare(
      `UPDATE control_workflow_intents SET status = 'running', updated_at = ?
       WHERE id = ? AND user_id = ? AND workspace_id = ? AND status = 'interrupted'`,
    ).bind(
      timestamp,
      approval.workflow_intent_id,
      identity.scope.userId,
      identity.scope.workspaceId,
    ),
    appendLedgerStatement(env, identity, {
      proposalId: row.id,
      status: "approved",
      requiredStatus: "approved",
      requiredUpdatedAt: timestamp,
      summary: "Action approved by workspace operator.",
      timestamp,
    }),
    ...actionEvidenceStatements(env, identity, {
      proposalId: row.id,
      action: "action.approved",
      eventType: "action.approved",
      summary: "External mutation approved by a workspace operator.",
      status: "approved",
      timestamp,
      data: { approvalRequestId: approval.id, runId: approval.run_id },
    }),
  ]);
  if ((results[1]?.meta?.changes ?? 0) === 0)
    return json(
      { ok: false, code: "action_conflict", error: "Action approval lost the transition race." },
      { status: 409 },
    );
  const result = await executeActionProposal(env, identity, row.id);
  const completedAt = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE control_runs SET status = ?, completed_at = CASE WHEN ? = 'completed' THEN ? ELSE completed_at END,
         failed_at = CASE WHEN ? = 'failed' THEN ? ELSE failed_at END, last_event_at = ?,
         data_json = json_set(data_json, '$.summary', ?, '$.actionProposalId', ?), updated_at = ?
       WHERE id = ? AND user_id = ? AND workspace_id = ? AND status = 'running'`,
    ).bind(
      result.status === "executed" || result.status === "reconciled" ? "completed" : "failed",
      result.status === "executed" || result.status === "reconciled" ? "completed" : "failed",
      completedAt,
      result.status === "executed" || result.status === "reconciled" ? "completed" : "failed",
      completedAt,
      completedAt,
      result.summary,
      row.id,
      completedAt,
      approval.run_id,
      identity.scope.userId,
      identity.scope.workspaceId,
    ),
    env.DB.prepare(
      `UPDATE control_workflow_intents SET status = ?, updated_at = ?
       WHERE id = ? AND user_id = ? AND workspace_id = ? AND status = 'running'`,
    ).bind(
      result.status === "executed" || result.status === "reconciled" ? "completed" : "failed",
      completedAt,
      approval.workflow_intent_id,
      identity.scope.userId,
      identity.scope.workspaceId,
    ),
  ]);
  return json(
    {
      ok: result.status === "executed" || result.status === "reconciled",
      result,
      approvalRequest: { id: approval.id, status: "approved" },
    },
    { status: result.status === "executed" || result.status === "reconciled" ? 200 : 502 },
  );
};

export const cancelActionForDeniedApproval = async (
  env: Env,
  identity: AgentIdentity,
  approval: ControlApprovalRequestRow,
  reason: string,
) => {
  const data = parseDataJson(approval.data_json);
  const proposalId = typeof data.actionProposalId === "string" ? data.actionProposalId : "";
  if (!proposalId) return;
  const timestamp = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE control_action_proposals SET status = 'cancelled', error_json = ?, version = version + 1,
         terminal_at = ?, updated_at = ? WHERE id = ? AND user_id = ? AND workspace_id = ?
         AND status = 'approval_requested'`,
    ).bind(
      toJson({ code: "approval_denied", summary: reason }),
      timestamp,
      timestamp,
      proposalId,
      identity.scope.userId,
      identity.scope.workspaceId,
    ),
    appendLedgerStatement(env, identity, {
      proposalId,
      status: "cancelled",
      requiredStatus: "cancelled",
      requiredUpdatedAt: timestamp,
      summary: reason,
      timestamp,
    }),
    ...actionEvidenceStatements(env, identity, {
      proposalId,
      action: "action.cancelled",
      eventType: "action.cancelled",
      summary: reason,
      status: "cancelled",
      timestamp,
      data: { approvalRequestId: approval.id, reason: "approval_denied" },
    }),
  ]);
};

export const handleReconcileAction = async (
  env: Env,
  identity: AgentIdentity,
  proposalId: string,
) => {
  try {
    const result = await reconcileActionProposal(env, identity, proposalId);
    const resolved = result.status === "reconciled" || result.status === "executed";
    return json({ ok: resolved, result }, { status: resolved ? 200 : 202 });
  } catch (error) {
    return json(
      {
        ok: false,
        code:
          error && typeof error === "object" && "code" in error
            ? error.code
            : "reconciliation_failed",
        error: error instanceof Error ? error.message : "Reconciliation failed.",
      },
      { status: 409 },
    );
  }
};

export const handleListKillSwitches = async (env: Env, identity: AgentIdentity) => {
  const rows = await env.DB.prepare(
    `SELECT id, scope_kind, scope_id, enabled, reason, created_by_user_id, version, created_at, updated_at
     FROM control_kill_switches WHERE user_id = ? AND workspace_id = ? ORDER BY updated_at DESC`,
  )
    .bind(identity.scope.userId, identity.scope.workspaceId)
    .all<Record<string, unknown>>();
  return json({ ok: true, killSwitches: rows.results });
};

export const handleUpdateKillSwitch = async (
  request: Request,
  env: Env,
  identity: AgentIdentity,
) => {
  const membership = await selectMembership(env, identity.scope.userId, identity.scope.workspaceId);
  const adminError = requireAdminMembership(membership);
  if (adminError) return adminError;
  const body = await request.json().catch(() => null);
  if (
    !isRecord(body) ||
    !["workspace", "pack", "tool", "connection"].includes(String(body.scopeKind)) ||
    typeof body.scopeId !== "string" ||
    !body.scopeId.trim() ||
    typeof body.enabled !== "boolean" ||
    typeof body.reason !== "string" ||
    !body.reason.trim()
  ) {
    return json({ ok: false, error: "Invalid kill-switch payload." }, { status: 400 });
  }
  const timestamp = new Date().toISOString();
  const id = createId("cf-kill-switch");
  const affected = body.enabled
    ? await env.DB.prepare(
        `SELECT id, approval_request_id, run_id, workflow_intent_id
         FROM control_action_proposals WHERE user_id = ? AND workspace_id = ?
           AND status IN ('proposed', 'approval_requested', 'approved') AND (
             ? = 'workspace' OR (? = 'pack' AND pack_id = ?) OR (? = 'tool' AND tool_id = ?)
             OR (? = 'connection' AND (
               connection_record_id = ? OR connection_record_id IN (
                 SELECT id FROM control_connections
                 WHERE user_id = ? AND workspace_id = ? AND connection_id = ?
               )
             ))
           )`,
      )
        .bind(
          identity.scope.userId,
          identity.scope.workspaceId,
          body.scopeKind,
          body.scopeKind,
          body.scopeId,
          body.scopeKind,
          body.scopeId,
          body.scopeKind,
          body.scopeId,
          identity.scope.userId,
          identity.scope.workspaceId,
          body.scopeId,
        )
        .all<{
          id: string;
          approval_request_id: string | null;
          run_id: string;
          workflow_intent_id: string;
        }>()
    : { results: [] };
  const statements = [
    env.DB.prepare(
      `INSERT INTO control_kill_switches (id, user_id, workspace_id, scope_kind, scope_id, enabled,
         reason, created_by_user_id, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(user_id, workspace_id, scope_kind, scope_id) DO UPDATE SET
         enabled = excluded.enabled, reason = excluded.reason, created_by_user_id = excluded.created_by_user_id,
         version = control_kill_switches.version + 1, updated_at = excluded.updated_at`,
    ).bind(
      id,
      identity.scope.userId,
      identity.scope.workspaceId,
      body.scopeKind,
      body.scopeId.trim(),
      body.enabled ? 1 : 0,
      body.reason.trim().slice(0, 240),
      identity.scope.userId,
      timestamp,
      timestamp,
    ),
    env.DB.prepare(
      `INSERT INTO control_audit_events (
         id, user_id, workspace_id, action, summary, target_type, target_id, data_json, created_at
       ) VALUES (?, ?, ?, 'action.kill_switch.updated', ?, 'killSwitch', ?, ?, ?)`,
    ).bind(
      createId("cf-audit"),
      identity.scope.userId,
      identity.scope.workspaceId,
      body.reason.trim().slice(0, 240),
      `${body.scopeKind}:${body.scopeId}`,
      toJson({ scopeKind: body.scopeKind, scopeId: body.scopeId, enabled: body.enabled }),
      timestamp,
    ),
  ];
  for (const proposal of affected.results) {
    statements.push(
      env.DB.prepare(
        `UPDATE control_action_proposals SET status = 'cancelled', error_json = ?, terminal_at = ?,
           version = version + 1, updated_at = ? WHERE id = ? AND user_id = ? AND workspace_id = ?
           AND status IN ('proposed', 'approval_requested', 'approved')`,
      ).bind(
        toJson({ code: "kill_switch_active" }),
        timestamp,
        timestamp,
        proposal.id,
        identity.scope.userId,
        identity.scope.workspaceId,
      ),
      appendLedgerStatement(env, identity, {
        proposalId: proposal.id,
        status: "cancelled",
        requiredStatus: "cancelled",
        requiredUpdatedAt: timestamp,
        summary: "Action cancelled by an operator kill switch.",
        data: { scopeKind: body.scopeKind, scopeId: body.scopeId },
        timestamp,
      }),
    );
    if (proposal.approval_request_id) {
      statements.push(
        env.DB.prepare(
          `UPDATE control_approval_requests SET status = 'cancelled', updated_at = ?
           WHERE id = ? AND user_id = ? AND workspace_id = ? AND status = 'requested'`,
        ).bind(
          timestamp,
          proposal.approval_request_id,
          identity.scope.userId,
          identity.scope.workspaceId,
        ),
        env.DB.prepare(
          `UPDATE control_runs SET status = 'cancelled', cancelled_at = ?, updated_at = ?
           WHERE id = ? AND user_id = ? AND workspace_id = ? AND status = 'interrupted'`,
        ).bind(
          timestamp,
          timestamp,
          proposal.run_id,
          identity.scope.userId,
          identity.scope.workspaceId,
        ),
        env.DB.prepare(
          `UPDATE control_workflow_intents SET status = 'cancelled', updated_at = ?
           WHERE id = ? AND user_id = ? AND workspace_id = ? AND status = 'interrupted'`,
        ).bind(
          timestamp,
          proposal.workflow_intent_id,
          identity.scope.userId,
          identity.scope.workspaceId,
        ),
      );
    }
  }
  await env.DB.batch(statements);
  return json({
    ok: true,
    killSwitch: {
      scopeKind: body.scopeKind,
      scopeId: body.scopeId,
      enabled: body.enabled,
      reason: body.reason,
    },
  });
};
