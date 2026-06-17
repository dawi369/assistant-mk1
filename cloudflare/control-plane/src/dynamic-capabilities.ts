import { selectMembership } from "./authz-store";
import { connectionAuthForTool, type ConnectionAuthBrokerage } from "./connection-auth";
import {
  evaluateToolPolicy,
  toolPolicyCatalog,
  type ToolPolicyResult,
  type ToolPolicySurface,
} from "./tool-policy";
import type { AgentIdentity, Env, ExecutionMode } from "./types";

type WorkflowStage = "observe" | "analyze" | "propose" | "execute" | "review";

export type DynamicCapabilityContext = {
  stage: WorkflowStage;
  executionMode: ExecutionMode;
  surface: ToolPolicySurface;
  platform: "cloudflare-control-plane";
  featureFlags: string[];
};

export type DynamicCapabilityDecision = {
  capabilityId: string;
  kind: "tool";
  visible: boolean;
  decision: ToolPolicyResult["decision"];
  code: ToolPolicyResult["code"];
  reason: string;
  policyReference?: string;
  permissionStatus?: string;
  allowedExecutionModes: ExecutionMode[];
  approvalRequired: boolean;
  adminVisible: boolean;
  modelVisible: boolean;
  policyEditable: boolean;
  constraints: ToolPolicyResult["constraints"];
  connectionAuth: ConnectionAuthBrokerage;
};

const workflowStages = new Set<WorkflowStage>([
  "observe",
  "analyze",
  "propose",
  "execute",
  "review",
]);

const executionModes = new Set<ExecutionMode>(["ask", "dry_run", "execute"]);

const capabilitySurfaces = new Set<ToolPolicySurface>([
  "admin_list",
  "admin_run",
  "admin_resume",
  "model_exposure",
  "model_tool_call",
]);

const readEnum = <T extends string>(value: string | null, allowed: Set<T>, fallback: T) =>
  value && allowed.has(value as T) ? (value as T) : fallback;

const readFeatureFlags = (value: string | null) =>
  (value ?? "")
    .split(",")
    .map((flag) => flag.trim())
    .filter((flag) => /^[a-z0-9_.:-]{1,64}$/i.test(flag))
    .slice(0, 16);

export const readDynamicCapabilityContext = (url?: URL): DynamicCapabilityContext => ({
  stage: readEnum(url?.searchParams.get("stage") ?? null, workflowStages, "observe"),
  executionMode: readEnum(
    url?.searchParams.get("executionMode") ?? null,
    executionModes,
    "dry_run",
  ),
  surface: readEnum(url?.searchParams.get("surface") ?? null, capabilitySurfaces, "model_exposure"),
  platform: "cloudflare-control-plane",
  featureFlags: readFeatureFlags(url?.searchParams.get("featureFlags") ?? null),
});

export const toDynamicCapabilityDecision = (
  toolName: string,
  policy: ToolPolicyResult,
): DynamicCapabilityDecision => ({
  capabilityId: toolName,
  kind: "tool",
  visible: policy.decision === "allow",
  decision: policy.decision,
  code: policy.code,
  reason: policy.reason,
  policyReference: policy.policyReference,
  permissionStatus: policy.permission?.status,
  allowedExecutionModes: policy.allowedExecutionModes,
  approvalRequired: policy.approvalRequired,
  adminVisible: policy.adminVisible,
  modelVisible: policy.modelVisible,
  policyEditable: policy.policyEditable,
  constraints: policy.constraints,
  connectionAuth: connectionAuthForTool(toolName),
});

export const resolveDynamicToolCapabilities = async (
  env: Env,
  identity: AgentIdentity,
  context: DynamicCapabilityContext,
) => {
  const membership = await selectMembership(env, identity.scope.userId, identity.scope.workspaceId);
  return Promise.all(
    Object.keys(toolPolicyCatalog).map(async (toolName) => {
      const policy = await evaluateToolPolicy(env, identity, {
        membership,
        toolName,
        executionMode: context.executionMode,
        surface: context.surface,
      });
      return toDynamicCapabilityDecision(toolName, policy);
    }),
  );
};
