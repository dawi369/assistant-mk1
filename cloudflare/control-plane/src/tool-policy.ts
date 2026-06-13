import { appendControlPlaneEvent } from "./control-plane-events";
import { isAdminMembership } from "./membership-policy";
import { isRecord, parseDataJson } from "./http";
import {
  createId,
  toJson,
  type AgentIdentity,
  type Env,
  type ExecutionMode,
  type MembershipRow,
  type ToolPermissionRow,
  type ToolPermissionStatus,
} from "./types";

export const urlInspectToolName = "url.inspect";
export const urlInspectPolicy = "tool-admin-readonly-v0";
export const demoInspectToolName = "demo.inspect";
export const demoInspectPolicy = "dev-demo";

export type ToolPolicySurface = "admin_list" | "admin_run" | "model_exposure";

export type ToolPolicyResult = {
  decision: "allow" | "block";
  status: 200 | 403;
  code:
    | "allowed"
    | "unsupported_tool"
    | "inactive_membership"
    | "admin_required"
    | "tool_disabled"
    | "approval_required"
    | "unsupported_execution_mode"
    | "model_exposure_blocked";
  reason: string;
  executionMode: ExecutionMode;
  policyReference?: string;
  permission?: ToolPermissionRow;
  adminVisible: boolean;
  modelVisible: boolean;
  approvalRequired: boolean;
  killSwitchReason?: string;
  allowedExecutionModes: ExecutionMode[];
};

type ToolPolicyDefaults = {
  policyReference: string;
  allowedExecutionModes: ExecutionMode[];
  adminVisible: boolean;
  modelVisible: boolean;
  requiresApproval: boolean;
  status: ToolPermissionStatus;
};

const executionModes = new Set<ExecutionMode>(["ask", "dry_run", "execute"]);

const toolDefaults: Record<string, ToolPolicyDefaults> = {
  [urlInspectToolName]: {
    policyReference: urlInspectPolicy,
    allowedExecutionModes: ["dry_run"],
    adminVisible: true,
    modelVisible: false,
    requiresApproval: false,
    status: "enabled",
  },
  [demoInspectToolName]: {
    policyReference: demoInspectPolicy,
    allowedExecutionModes: ["dry_run"],
    adminVisible: false,
    modelVisible: false,
    requiresApproval: false,
    status: "enabled",
  },
};

const readDataFlag = (data: Record<string, unknown>, name: string, fallback: boolean) =>
  typeof data[name] === "boolean" ? data[name] : fallback;

const readExecutionMode = (raw: string): ExecutionMode =>
  executionModes.has(raw as ExecutionMode) ? (raw as ExecutionMode) : "ask";

export const isKnownTool = (toolName: string) => Boolean(toolDefaults[toolName]);

const defaultExecution = (defaults: ToolPolicyDefaults) => ({
  mode: defaults.allowedExecutionModes[0],
  policy: defaults.policyReference,
});

const defaultData = (defaults: ToolPolicyDefaults) => ({
  adminVisible: defaults.adminVisible,
  modelVisible: defaults.modelVisible,
  requiresApproval: defaults.requiresApproval,
});

export const ensureToolPermission = async (env: Env, identity: AgentIdentity, toolName: string) => {
  const defaults = toolDefaults[toolName];
  if (!defaults) return null;

  const timestamp = new Date().toISOString();
  const existing = await env.DB.prepare(
    `SELECT id, user_id, workspace_id, agent_id, tool_id, status, execution_json, data_json,
            created_at, updated_at
     FROM tool_permissions
     WHERE user_id = ? AND workspace_id = ? AND agent_id = ? AND tool_id = ?
     LIMIT 1`,
  )
    .bind(identity.scope.userId, identity.scope.workspaceId, identity.agentId, toolName)
    .first<ToolPermissionRow>();
  if (existing) return existing;

  const permission: ToolPermissionRow = {
    id: createId("cf-tool-permission"),
    user_id: identity.scope.userId,
    workspace_id: identity.scope.workspaceId,
    agent_id: identity.agentId,
    tool_id: toolName,
    status: defaults.status,
    execution_json: toJson(defaultExecution(defaults)),
    data_json: toJson(defaultData(defaults)),
    created_at: timestamp,
    updated_at: timestamp,
  };

  await env.DB.prepare(
    `INSERT INTO tool_permissions (
       id, user_id, workspace_id, agent_id, tool_id, status, execution_json, data_json,
       created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      permission.id,
      permission.user_id,
      permission.workspace_id,
      permission.agent_id,
      permission.tool_id,
      permission.status,
      permission.execution_json,
      permission.data_json,
      permission.created_at,
      permission.updated_at,
    )
    .run();

  return permission;
};

export const updateToolPermissionStatus = async (
  env: Env,
  identity: AgentIdentity,
  input: { toolName: string; status: ToolPermissionStatus },
) => {
  const permission = await ensureToolPermission(env, identity, input.toolName);
  if (!permission) return null;

  const timestamp = new Date().toISOString();
  const data = parseDataJson(permission.data_json);
  const nextData = {
    ...data,
    killSwitchReason:
      input.status === "disabled"
        ? "Disabled by workspace admin policy."
        : isRecord(data) && typeof data.killSwitchReason === "string"
          ? undefined
          : undefined,
  };
  if (input.status !== "disabled") delete nextData.killSwitchReason;

  await env.DB.prepare(
    `UPDATE tool_permissions
     SET status = ?, data_json = ?, updated_at = ?
     WHERE user_id = ? AND workspace_id = ? AND agent_id = ? AND tool_id = ?`,
  )
    .bind(
      input.status,
      toJson(nextData),
      timestamp,
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.agentId,
      input.toolName,
    )
    .run();

  return ensureToolPermission(env, identity, input.toolName);
};

export const evaluateToolPolicy = async (
  env: Env,
  identity: AgentIdentity,
  input: {
    membership: MembershipRow | null;
    toolName: string;
    executionMode: string;
    surface: ToolPolicySurface;
  },
): Promise<ToolPolicyResult> => {
  const defaults = toolDefaults[input.toolName];
  const executionMode = readExecutionMode(input.executionMode);
  if (!defaults) {
    return {
      decision: "block",
      status: 403,
      code: "unsupported_tool",
      reason: "Tool is not registered in the policy catalog.",
      executionMode,
      adminVisible: false,
      modelVisible: false,
      approvalRequired: false,
      allowedExecutionModes: [],
    };
  }

  const permission = await ensureToolPermission(env, identity, input.toolName);
  const data = parseDataJson(permission?.data_json ?? "{}");
  const adminVisibleFlag = readDataFlag(data, "adminVisible", defaults.adminVisible);
  const modelVisibleFlag = readDataFlag(data, "modelVisible", defaults.modelVisible);
  const approvalRequired = readDataFlag(data, "requiresApproval", defaults.requiresApproval);
  const killSwitchReason =
    typeof data.killSwitchReason === "string" ? data.killSwitchReason : undefined;
  const execution = parseDataJson(permission?.execution_json ?? "{}");
  const policyReference =
    isRecord(execution) && typeof execution.policy === "string"
      ? String(execution.policy)
      : defaults.policyReference;

  const base = {
    executionMode,
    policyReference,
    permission: permission ?? undefined,
    adminVisible: false,
    modelVisible: false,
    approvalRequired,
    killSwitchReason,
    allowedExecutionModes: defaults.allowedExecutionModes,
  };

  if (!input.membership || input.membership.status !== "active") {
    return {
      ...base,
      decision: "block",
      status: 403,
      code: "inactive_membership",
      reason: "Workspace membership is not active.",
    };
  }

  if (permission?.status === "disabled") {
    return {
      ...base,
      decision: "block",
      status: 403,
      code: "tool_disabled",
      reason: killSwitchReason ?? "Tool is disabled by workspace policy.",
    };
  }

  if (permission?.status === "pending_review") {
    return {
      ...base,
      decision: "block",
      status: 403,
      code: "approval_required",
      reason: "Tool permission is pending review.",
    };
  }

  if (!defaults.allowedExecutionModes.includes(executionMode)) {
    return {
      ...base,
      decision: "block",
      status: 403,
      code: "unsupported_execution_mode",
      reason: `${input.toolName} only supports ${defaults.allowedExecutionModes.join(", ")}.`,
    };
  }

  if (input.surface === "model_exposure") {
    return {
      ...base,
      decision: "block",
      status: 403,
      code: "model_exposure_blocked",
      reason: "Model-visible tool exposure is blocked until policy v0 is promoted.",
      modelVisible: false,
    };
  }

  if (!isAdminMembership(input.membership)) {
    return {
      ...base,
      decision: "block",
      status: 403,
      code: "admin_required",
      reason: "Workspace owner/admin membership is required to use this Admin tool.",
    };
  }

  if (input.surface === "admin_list" && !adminVisibleFlag) {
    return {
      ...base,
      decision: "block",
      status: 403,
      code: "admin_required",
      reason: "Tool is not exposed in Admin for this workspace.",
    };
  }

  if (approvalRequired) {
    return {
      ...base,
      decision: "block",
      status: 403,
      code: "approval_required",
      reason: "Tool requires approval, but approval flow is not enabled in v0.",
      adminVisible: adminVisibleFlag,
      modelVisible: modelVisibleFlag,
    };
  }

  return {
    ...base,
    decision: "allow",
    status: 200,
    code: "allowed",
    reason:
      input.surface === "admin_run"
        ? `${input.toolName} is enabled for Admin dry-run execution.`
        : `${input.toolName} is enabled by workspace policy.`,
    adminVisible: adminVisibleFlag,
    modelVisible: false,
  };
};

export const recordToolPolicyDecision = async (
  env: Env,
  identity: AgentIdentity,
  input: {
    toolName: string;
    surface: ToolPolicySurface;
    result: ToolPolicyResult;
    data?: Record<string, unknown>;
  },
) => {
  const timestamp = new Date().toISOString();
  const decisionId = createId("cf-policy");
  await env.DB.prepare(
    `INSERT INTO control_policy_decisions (
       id, user_id, workspace_id, agent_id, tool_id, surface, decision, reason,
       execution_mode, policy_reference, data_json, created_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      decisionId,
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.agentId,
      input.toolName,
      input.surface,
      input.result.decision,
      input.result.reason,
      input.result.executionMode,
      input.result.policyReference ?? null,
      toJson({
        code: input.result.code,
        permissionId: input.result.permission?.id,
        status: input.result.permission?.status,
        ...input.data,
      }),
      timestamp,
    )
    .run();

  await env.DB.prepare(
    `INSERT INTO control_audit_events (
       id, user_id, workspace_id, action, summary, target_type, target_id, data_json, created_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      createId("cf-audit"),
      identity.scope.userId,
      identity.scope.workspaceId,
      input.result.decision === "allow" ? "tool.policy.allowed" : "tool.policy.blocked",
      input.result.reason,
      "toolPolicyDecision",
      decisionId,
      toJson({
        eventName:
          input.result.decision === "allow" ? "tool.policy.allowed" : "tool.policy.blocked",
        agentId: identity.agentId,
        toolName: input.toolName,
        surface: input.surface,
        code: input.result.code,
        policyReference: input.result.policyReference,
      }),
      timestamp,
    )
    .run();

  await appendControlPlaneEvent(env, identity, {
    type: input.result.decision === "allow" ? "tool.policy.allowed" : "tool.policy.blocked",
    summary: input.result.reason,
    targetType: "toolPolicyDecision",
    targetId: decisionId,
    data: {
      toolName: input.toolName,
      surface: input.surface,
      code: input.result.code,
      decision: input.result.decision,
      policyReference: input.result.policyReference,
    },
  });

  return decisionId;
};

export const toolPolicyError = (result: ToolPolicyResult) => ({
  code: result.code,
  message: result.reason,
  retryable: false,
  redacted: true as const,
});
