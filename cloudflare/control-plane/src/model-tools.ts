import { jsonSchema, tool, type ToolSet } from "ai";

import { selectMembership } from "./authz-store";
import { dispatchWorkbenchSessionEvent } from "./session-coordinator";
import {
  executeUrlInspectRunner,
  insertToolRunRecords,
  listLatestArtifacts,
  listLatestToolCalls,
} from "./admin-tools";
import { validateUrlInspectInput } from "../../../lib/workbench/url-inspect";
import {
  evaluateToolPolicy,
  recordToolPolicyDecision,
  toolPolicyError,
  toolPolicyCatalog,
  urlInspectPolicy,
  urlInspectToolName,
} from "./tool-policy";
import { parseDataJson } from "./http";
import type { AgentIdentity, Env } from "./types";

type ResolveModelToolsInput = {
  chatRunId: string | null;
  threadId: string;
  traceId: string;
};

type ModelToolExposure = {
  decision: string;
  code: string;
  reason: string;
  fastPath?: boolean;
};

const negativeModelToolCandidateCacheTtlMs = 30_000;
const negativeModelToolCandidateCache = new Map<string, { expiresAtMs: number }>();

const readDataFlag = (data: Record<string, unknown>, name: string, fallback: boolean) =>
  typeof data[name] === "boolean" ? data[name] : fallback;

const modelToolCandidateCacheKey = (identity: AgentIdentity, toolName: string) =>
  [identity.scope.userId, identity.scope.workspaceId, identity.agentId, toolName].join(":");

const readNegativeModelToolCandidateCache = (cacheKey: string, nowMs: number) => {
  const cached = negativeModelToolCandidateCache.get(cacheKey);
  if (!cached) return false;
  if (cached.expiresAtMs <= nowMs) {
    negativeModelToolCandidateCache.delete(cacheKey);
    return false;
  }
  return true;
};

const rememberNegativeModelToolCandidate = (cacheKey: string, nowMs: number) => {
  negativeModelToolCandidateCache.set(cacheKey, {
    expiresAtMs: nowMs + negativeModelToolCandidateCacheTtlMs,
  });
};

const resolvePermissionCandidate = (
  permission: { status: string; data_json: string } | null,
  defaults: NonNullable<(typeof toolPolicyCatalog)[string]>,
) => {
  if (!permission) {
    return defaults.status === "enabled" && defaults.modelVisible && !defaults.requiresApproval;
  }
  if (permission.status !== "enabled") return false;

  const data = parseDataJson(permission.data_json);
  return (
    readDataFlag(data, "modelVisible", defaults.modelVisible) &&
    !readDataFlag(data, "requiresApproval", defaults.requiresApproval)
  );
};

export const resetModelToolCandidateCacheForTests = () => {
  negativeModelToolCandidateCache.clear();
};

export const hasModelVisibleToolCandidate = async (
  env: Env,
  identity: AgentIdentity,
  toolName = urlInspectToolName,
) => {
  const defaults = toolPolicyCatalog[toolName];
  if (!defaults) return false;

  const cacheKey = modelToolCandidateCacheKey(identity, toolName);
  const nowMs = Date.now();
  if (readNegativeModelToolCandidateCache(cacheKey, nowMs)) return false;

  const permission = await env.DB.prepare(
    `SELECT status, data_json
     FROM tool_permissions
     WHERE user_id = ? AND workspace_id = ? AND agent_id = ? AND tool_id = ?
     LIMIT 1`,
  )
    .bind(identity.scope.userId, identity.scope.workspaceId, identity.agentId, toolName)
    .first<{ status: string; data_json: string }>();

  const hasCandidate = resolvePermissionCandidate(permission, defaults);
  if (!hasCandidate) {
    rememberNegativeModelToolCandidate(cacheKey, nowMs);
    return false;
  }
  negativeModelToolCandidateCache.delete(cacheKey);
  return true;
};

export const resolveModelVisibleTools = async (
  env: Env,
  identity: AgentIdentity,
  input: ResolveModelToolsInput,
): Promise<{ tools: ToolSet; exposure: ModelToolExposure }> => {
  const hasCandidate = await hasModelVisibleToolCandidate(env, identity, urlInspectToolName);
  if (!hasCandidate) {
    return {
      tools: {},
      exposure: {
        decision: "block",
        code: "no_model_visible_tools",
        reason: "No model-visible tools are enabled for this agent.",
        fastPath: true,
      },
    };
  }

  const membership = await selectMembership(env, identity.scope.userId, identity.scope.workspaceId);
  const exposurePolicy = await evaluateToolPolicy(env, identity, {
    membership,
    toolName: urlInspectToolName,
    executionMode: "dry_run",
    surface: "model_exposure",
  });

  if (exposurePolicy.decision === "block") {
    return {
      tools: {},
      exposure: {
        decision: exposurePolicy.decision,
        code: exposurePolicy.code,
        reason: exposurePolicy.reason,
      },
    };
  }

  return {
    exposure: {
      decision: exposurePolicy.decision,
      code: exposurePolicy.code,
      reason: exposurePolicy.reason,
    },
    tools: {
      urlInspect: tool({
        description:
          "Inspect a public http or https URL with a bounded read-only request. Local, private, metadata, and credentialed URLs are rejected.",
        inputSchema: jsonSchema<{ url: string }>({
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "Absolute public http or https URL to inspect.",
            },
          },
          required: ["url"],
          additionalProperties: false,
        }),
        execute: async ({ url }) => {
          const callPolicy = await evaluateToolPolicy(env, identity, {
            membership,
            toolName: urlInspectToolName,
            executionMode: "dry_run",
            surface: "model_tool_call",
          });
          const policyDecisionId = await recordToolPolicyDecision(env, identity, {
            toolName: urlInspectToolName,
            surface: "model_tool_call",
            result: callPolicy,
            data: {
              action: "model.tool.call",
              chatRunId: input.chatRunId,
              threadId: input.threadId,
              traceId: input.traceId,
            },
          });
          if (callPolicy.decision === "block") {
            return {
              ok: false,
              error: toolPolicyError(callPolicy),
              policyDecisionId,
            };
          }

          const validated = validateUrlInspectInput({ url });
          if (!validated.ok) {
            return {
              ok: false,
              error: validated.error,
              policyDecisionId,
            };
          }

          const resourcePolicy = await evaluateToolPolicy(env, identity, {
            membership,
            toolName: urlInspectToolName,
            executionMode: "dry_run",
            surface: "model_tool_call",
            resource: {
              kind: "url",
              value: validated.url.toString(),
              host: validated.url.hostname.toLowerCase(),
            },
          });
          if (resourcePolicy.decision === "block") {
            const resourcePolicyDecisionId = await recordToolPolicyDecision(env, identity, {
              toolName: urlInspectToolName,
              surface: "model_tool_call",
              result: resourcePolicy,
              data: {
                action: "model.tool.call.resource",
                chatRunId: input.chatRunId,
                threadId: input.threadId,
                traceId: input.traceId,
              },
            });
            return {
              ok: false,
              error: toolPolicyError(resourcePolicy),
              policyDecisionId: resourcePolicyDecisionId,
            };
          }

          const runIdentity = await insertToolRunRecords(env, identity, {
            url: validated.url,
            executionMode: callPolicy.executionMode,
            policyDecisionId,
            source: "model",
            parentRunId: input.chatRunId,
            traceId: input.traceId,
          });
          const { result, finished } = await executeUrlInspectRunner(
            env,
            runIdentity,
            validated.url,
            {
              executionMode: callPolicy.executionMode,
              policyDecisionId,
              traceId: input.traceId,
            },
          );
          await dispatchWorkbenchSessionEvent(env, identity, {
            type: "tool.run.updated",
            data: {
              toolName: urlInspectToolName,
              runId: runIdentity.runId,
              workflowIntentId: runIdentity.workflowIntentId,
              toolCallId: finished.toolCallId,
              artifactId: finished.artifact?.id ?? null,
              status: result.ok ? "completed" : "failed",
              traceId: input.traceId,
              source: "model",
              errorCode: result.ok ? undefined : result.error.code,
            },
          });
          await dispatchWorkbenchSessionEvent(env, identity, {
            type: "admin.summary.invalidated",
            data: {
              reason: "model-tool-run-updated",
              toolName: urlInspectToolName,
              runId: runIdentity.runId,
              traceId: input.traceId,
            },
          });

          const [latestToolCalls, latestArtifacts] = await Promise.all([
            listLatestToolCalls(env, identity.scope),
            listLatestArtifacts(env, identity.scope),
          ]);
          const toolCall = latestToolCalls.find((call) => call.id === finished.toolCallId) ?? null;
          const artifact = finished.artifact
            ? (latestArtifacts.find((item) => item.id === finished.artifact?.id) ??
              finished.artifact)
            : null;

          return {
            ok: result.ok,
            toolName: urlInspectToolName,
            execution: { mode: callPolicy.executionMode, policy: urlInspectPolicy },
            run: {
              id: runIdentity.runId,
              workflowIntentId: runIdentity.workflowIntentId,
              status: result.ok ? "completed" : "failed",
            },
            toolCall,
            artifact,
            output: result.ok ? result.output : undefined,
            error: result.ok ? undefined : result.error,
            policyDecisionId,
          };
        },
      }),
    },
  };
};
