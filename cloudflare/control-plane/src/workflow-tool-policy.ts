import { selectMembership } from "./authz-store";
import { json } from "./http";
import {
  evaluateToolPolicy,
  recordToolPolicyDecision,
  toolPolicyError,
  type ToolPolicyResource,
} from "./tool-policy";
import type { AgentIdentity, Env } from "./types";

export const authorizeWorkflowTools = async (
  env: Env,
  identity: AgentIdentity,
  input: {
    toolNames: string[];
    executionMode: string;
    resource?: ToolPolicyResource;
    requestedRuntimeMs?: number;
    requestedArtifactBytes?: number;
  },
) => {
  const membership = await selectMembership(env, identity.scope.userId, identity.scope.workspaceId);
  for (const toolName of input.toolNames) {
    const result = await evaluateToolPolicy(env, identity, {
      membership,
      toolName,
      executionMode: input.executionMode,
      surface: "workflow",
      resource: input.resource,
      requestedRuntimeMs: input.requestedRuntimeMs,
      requestedArtifactBytes: input.requestedArtifactBytes,
    });
    const decisionId = await recordToolPolicyDecision(env, identity, {
      toolName,
      surface: "workflow",
      result,
      data: { source: "pack_workflow" },
    });
    if (result.decision === "block") {
      return {
        ok: false as const,
        response: json(
          {
            ok: false,
            error: result.reason,
            details: { ...toolPolicyError(result), policyDecisionId: decisionId },
          },
          { status: result.status },
        ),
      };
    }
  }
  return { ok: true as const };
};
