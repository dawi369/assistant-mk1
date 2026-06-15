import { jsonSchema, tool, type ToolSet } from "ai";

import { selectMembership } from "./authz-store";
import { dispatchWorkbenchSessionEvent } from "./session-coordinator";
import {
  finishToolRun,
  insertToolRunRecords,
  inspectUrl,
  listLatestArtifacts,
  listLatestToolCalls,
  validateUrlInspectInput,
} from "./admin-tools";
import {
  evaluateToolPolicy,
  recordToolPolicyDecision,
  toolPolicyError,
  urlInspectPolicy,
  urlInspectToolName,
} from "./tool-policy";
import type { AgentIdentity, Env } from "./types";

type ResolveModelToolsInput = {
  chatRunId: string | null;
  threadId: string;
  traceId: string;
};

export const resolveModelVisibleTools = async (
  env: Env,
  identity: AgentIdentity,
  input: ResolveModelToolsInput,
): Promise<{ tools: ToolSet; exposure: { decision: string; code: string; reason: string } }> => {
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
          const result = await inspectUrl(validated.url);
          const finished = await finishToolRun(env, runIdentity, result);
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
