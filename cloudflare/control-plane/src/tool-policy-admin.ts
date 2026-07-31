import { selectMembership } from "./authz-store";
import { appendControlPlaneEvent } from "./control-plane-events";
import { isRecord, json, parseJson } from "./http";
import { isAdminMembership } from "./membership-policy";
import {
  listLatestArtifacts,
  listLatestToolCalls,
  resolveToolSummaries,
} from "./runtime-tool-catalog";
import { dispatchWorkbenchSessionEvent } from "./session-coordinator";
import {
  evaluateToolPolicy,
  isKnownTool,
  isPolicyEditableTool,
  recordToolPolicyDecision,
  toolPolicyError,
  updateToolPermissionStatus,
} from "./tool-policy";
import type { AgentIdentity, Env, ExecutionMode, ToolPermissionStatus } from "./types";

const error = (code: string, message: string) => ({
  code,
  message,
  retryable: false,
  redacted: true as const,
});

export const handleListTools = async (request: Request, env: Env, identity: AgentIdentity) => {
  const [toolResolution, latestToolCalls, latestArtifacts] = await Promise.all([
    resolveToolSummaries(env, identity),
    listLatestToolCalls(env, identity.scope),
    listLatestArtifacts(env, identity.scope),
  ]);
  return json({
    ok: true,
    capabilityContext: toolResolution.context,
    capabilityDecisions: toolResolution.decisions,
    tools: toolResolution.tools,
    latestToolCalls,
    latestArtifacts,
  });
};

const permissionStatuses = new Set<ToolPermissionStatus>(["enabled", "disabled"]);
const executionModes = new Set<ExecutionMode>(["ask", "dry_run", "execute"]);

export const handleUpdateToolPolicy = async (
  request: Request,
  env: Env,
  identity: AgentIdentity,
) => {
  const body = parseJson(await request.text());
  const toolName = isRecord(body) && typeof body.toolName === "string" ? body.toolName : "";
  if (!isKnownTool(toolName)) {
    return json(
      {
        ok: false,
        error: "Unsupported tool",
        details: error("unsupported_tool", "Tool is not registered."),
      },
      { status: 400 },
    );
  }
  if (!isPolicyEditableTool(toolName)) {
    return json(
      {
        ok: false,
        error: "Tool policy is not editable",
        details: error("tool_policy_not_editable", `${toolName} policy is not editable.`),
      },
      { status: 403 },
    );
  }

  const status = isRecord(body) && typeof body.status === "string" ? body.status : undefined;
  const requiresApproval =
    isRecord(body) && typeof body.requiresApproval === "boolean"
      ? body.requiresApproval
      : undefined;
  const modelVisible =
    isRecord(body) && typeof body.modelVisible === "boolean" ? body.modelVisible : undefined;
  const killSwitchReason =
    isRecord(body) && typeof body.killSwitchReason === "string"
      ? body.killSwitchReason.trim().slice(0, 240)
      : undefined;
  const approvalReason =
    isRecord(body) && typeof body.approvalReason === "string"
      ? body.approvalReason.trim().slice(0, 240)
      : undefined;
  const allowedExecutionModes =
    isRecord(body) && Array.isArray(body.allowedExecutionModes)
      ? body.allowedExecutionModes.filter(
          (mode): mode is ExecutionMode =>
            typeof mode === "string" && executionModes.has(mode as ExecutionMode),
        )
      : undefined;
  const limits = isRecord(body) && isRecord(body.limits) ? body.limits : undefined;
  const numberOrNull = (name: string) => {
    if (!isRecord(body)) return undefined;
    const value = body[name];
    return typeof value === "number" || value === null ? value : undefined;
  };
  const allowlist =
    isRecord(body) && Array.isArray(body.allowlist)
      ? body.allowlist.filter((item): item is string => typeof item === "string")
      : undefined;
  const denylist =
    isRecord(body) && Array.isArray(body.denylist)
      ? body.denylist.filter((item): item is string => typeof item === "string")
      : undefined;
  if (status !== undefined && !permissionStatuses.has(status as ToolPermissionStatus)) {
    return json(
      {
        ok: false,
        error: "Unsupported policy status",
        details: error("unsupported_policy_status", "Policy status must be enabled or disabled."),
      },
      { status: 400 },
    );
  }
  const changes = {
    status: status as ToolPermissionStatus | undefined,
    requiresApproval,
    modelVisible,
    killSwitchReason,
    approvalReason,
    allowedExecutionModes,
    limits,
    cooldownSeconds: numberOrNull("cooldownSeconds"),
    maxRuntimeMs: numberOrNull("maxRuntimeMs"),
    maxArtifactBytes: numberOrNull("maxArtifactBytes"),
    allowlist,
    denylist,
  };
  if (Object.values(changes).every((value) => value === undefined)) {
    return json(
      {
        ok: false,
        error: "No policy changes requested",
        details: error("invalid_policy_update", "Provide at least one supported policy field."),
      },
      { status: 400 },
    );
  }

  const membership = await selectMembership(env, identity.scope.userId, identity.scope.workspaceId);
  if (!membership || membership.status !== "active" || !isAdminMembership(membership)) {
    const policy = await evaluateToolPolicy(env, identity, {
      membership,
      toolName,
      executionMode: "dry_run",
      surface: "admin_list",
    });
    const policyDecisionId = await recordToolPolicyDecision(env, identity, {
      toolName,
      surface: "admin_list",
      result: policy,
      data: { action: "tool.policy.update" },
    });
    return json(
      { ok: false, error: policy.reason, details: toolPolicyError(policy), policyDecisionId },
      { status: policy.status },
    );
  }

  const permission = await updateToolPermissionStatus(env, identity, { toolName, ...changes });
  const resolution = await resolveToolSummaries(env, identity);
  const tool = resolution.tools.find((item) => item.name === toolName);
  await appendControlPlaneEvent(env, identity, {
    type: "tool.policy.updated",
    summary: `${toolName} policy updated.`,
    targetType: "toolPermission",
    targetId: permission?.id,
    data: { toolName, ...changes },
  });
  await dispatchWorkbenchSessionEvent(env, identity, {
    type: "admin.summary.invalidated",
    data: { reason: "tool-policy-updated", toolName, status: permission?.status },
  });
  return json({
    ok: true,
    toolName,
    status: permission?.status,
    requiresApproval: tool?.approvalRequired,
    modelVisible: tool?.modelVisible,
    policyConstraints: tool?.policyConstraints,
    permissionId: permission?.id,
    tool,
  });
};
