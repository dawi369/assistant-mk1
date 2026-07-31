import { jsonSchema, tool, type ToolSet } from "ai";
import {
  assertSchemaValue,
  defaultActionPort,
  defaultConnectionPort,
  type AgentExecutionContext,
  type RuntimeRecord,
  type RuntimeToolBinding,
} from "@assistant-mk1/agent-sdk/control-plane";

import { selectAgent, selectMembership } from "./authz-store";
import { resolveAgentBehaviorConfig } from "./agent-records";
import { upsertManagedState } from "./managed-state";
import { dispatchWorkbenchSessionEvent } from "./session-coordinator";
import {
  executeUrlInspectRunner,
  insertToolRunRecords,
  listLatestArtifacts,
  listLatestToolCalls,
} from "./tool-execution-service";
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
import { resolvePackRuntime } from "../../../lib/agent-runtime/registry";

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

export const modelToolKey = (toolId: string) => {
  const normalized = toolId.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^_+|_+$/g, "");
  return normalized || "runtime_tool";
};

export const runtimeModelToolBindingsForPack = (pack: {
  id: string;
  version: string;
  tools: readonly { id: string }[];
}) => {
  const runtime = resolvePackRuntime(pack.id, pack.version);
  if (!runtime.runnable) return [];
  return (runtime.controlPlane.tools as readonly RuntimeToolBinding[]).filter(
    (binding) =>
      binding.id !== urlInspectToolName &&
      binding.transport === "cloudflare_inline" &&
      binding.policy.modelVisible &&
      Boolean(binding.execute) &&
      pack.tools.some((declared) => declared.id === binding.id),
  );
};

const runtimeFailure = (error: unknown) => ({
  ok: false as const,
  error: {
    code:
      error && typeof error === "object" && "code" in error && typeof error.code === "string"
        ? error.code
        : "runtime_tool_failed",
    message: error instanceof Error ? error.message : "Runtime tool failed.",
    retryable: false,
    redacted: true,
  },
  summary: error instanceof Error ? error.message : "Runtime tool failed.",
});

const buildRuntimeModelTool = (input: {
  binding: RuntimeToolBinding;
  env: Env;
  identity: AgentIdentity;
  membership: Awaited<ReturnType<typeof selectMembership>>;
  pack: NonNullable<ReturnType<typeof resolveAgentBehaviorConfig>["pack"]>;
  runtimeVersion: string;
  request: ResolveModelToolsInput;
}) =>
  tool({
    description: input.binding.description,
    inputSchema: jsonSchema<RuntimeRecord>(input.binding.inputSchema),
    execute: async (toolInput) => {
      const callPolicy = await evaluateToolPolicy(input.env, input.identity, {
        membership: input.membership,
        toolName: input.binding.id,
        executionMode: "dry_run",
        surface: "model_tool_call",
      });
      const policyDecisionId = await recordToolPolicyDecision(input.env, input.identity, {
        toolName: input.binding.id,
        surface: "model_tool_call",
        result: callPolicy,
        data: {
          action: "model.tool.call",
          chatRunId: input.request.chatRunId,
          threadId: input.request.threadId,
          traceId: input.request.traceId,
          packId: input.pack.id,
          packVersion: input.pack.version,
          runtimeVersion: input.runtimeVersion,
          adapterVersion: input.binding.adapterVersion,
          transport: input.binding.transport,
        },
      });
      if (callPolicy.decision === "block") {
        return {
          ok: false,
          error: toolPolicyError(callPolicy),
          policyDecisionId,
        };
      }

      const controller = new AbortController();
      const timeout = setTimeout(
        () =>
          controller.abort(
            Object.assign(new Error("Runtime tool timed out."), {
              code: "runtime_timeout",
            }),
          ),
        input.binding.timeoutMs,
      );
      const context: AgentExecutionContext = {
        scope: { ...input.identity.scope, agentId: input.identity.agentId },
        pack: {
          id: input.pack.id,
          version: input.pack.version,
          runtimeVersion: input.runtimeVersion,
        },
        run: {
          id: input.request.chatRunId ?? `chat-${input.request.traceId}`,
          workflowIntentId: `chat-${input.request.threadId}`,
          executionMode: "dry_run",
          source: "user",
        },
        signal: controller.signal,
        connections: defaultConnectionPort(input.pack.connections),
        actions: defaultActionPort,
        tools: {
          async invoke() {
            throw Object.assign(new Error("Nested model-tool invocation is disabled."), {
              code: "nested_tool_invocation_disabled",
            });
          },
        },
        managedState: {
          async upsert(state) {
            const result = await upsertManagedState(input.env, input.identity, {
              id: `${input.identity.agentId}-${state.namespace}-${state.stateType}-${state.stateKey}`,
              ...state,
            });
            if (!result.ok) {
              throw Object.assign(new Error("Managed-state compare-and-set conflict."), {
                code: "managed_state_version_conflict",
              });
            }
            return { id: result.state.id, version: result.state.version };
          },
        },
        events: {
          async append(type, summary, data) {
            await dispatchWorkbenchSessionEvent(input.env, input.identity, {
              type: "admin.summary.invalidated",
              data: {
                reason: "runtime-model-tool-event",
                runtimeEventType: type,
                summary,
                toolName: input.binding.id,
                traceId: input.request.traceId,
                ...data,
              },
            });
          },
        },
      };

      try {
        assertSchemaValue(input.binding.inputSchema, toolInput, `${input.binding.id} input`);
        if (!input.binding.execute) {
          throw Object.assign(new Error("Runtime tool binding is not executable."), {
            code: "tool_binding_unavailable",
          });
        }
        const result = await input.binding.execute(toolInput, context);
        if (result.ok) {
          assertSchemaValue(
            input.binding.outputSchema,
            result.output,
            `${input.binding.id} output`,
          );
        }
        return {
          ...result,
          toolName: input.binding.id,
          policyDecisionId,
          runtimeVersion: input.runtimeVersion,
          adapterVersion: input.binding.adapterVersion,
        };
      } catch (error) {
        return {
          ...runtimeFailure(error),
          toolName: input.binding.id,
          policyDecisionId,
          runtimeVersion: input.runtimeVersion,
          adapterVersion: input.binding.adapterVersion,
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  });

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

  const agent = await selectAgent(env, identity.agentId, identity.scope.workspaceId);
  const pack = resolveAgentBehaviorConfig(agent).pack;
  if (pack && !pack.tools.some((tool) => tool.id === toolName)) {
    rememberNegativeModelToolCandidate(cacheKey, nowMs);
    return false;
  }

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
  const agent = await selectAgent(env, identity.agentId, identity.scope.workspaceId);
  const pack = resolveAgentBehaviorConfig(agent).pack;
  const runtime = pack ? resolvePackRuntime(pack.id, pack.version) : null;
  const genericBindings = pack ? runtimeModelToolBindingsForPack(pack) : [];
  const [hasUrlCandidate, genericCandidateFlags] = await Promise.all([
    hasModelVisibleToolCandidate(env, identity, urlInspectToolName),
    Promise.all(
      genericBindings.map((binding) => hasModelVisibleToolCandidate(env, identity, binding.id)),
    ),
  ]);
  if (!hasUrlCandidate && !genericCandidateFlags.some(Boolean)) {
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
  const urlExposurePolicy = hasUrlCandidate
    ? await evaluateToolPolicy(env, identity, {
        membership,
        toolName: urlInspectToolName,
        executionMode: "dry_run",
        surface: "model_exposure",
      })
    : null;
  const allowedGeneric: RuntimeToolBinding[] = [];
  let firstBlockedPolicy = urlExposurePolicy?.decision === "block" ? urlExposurePolicy : null;
  for (const [index, binding] of genericBindings.entries()) {
    if (!genericCandidateFlags[index]) continue;
    const policy = await evaluateToolPolicy(env, identity, {
      membership,
      toolName: binding.id,
      executionMode: "dry_run",
      surface: "model_exposure",
    });
    if (policy.decision === "allow") allowedGeneric.push(binding);
    else firstBlockedPolicy ??= policy;
  }
  const allowUrl = urlExposurePolicy?.decision === "allow";
  if (!allowUrl && allowedGeneric.length === 0) {
    return {
      tools: {},
      exposure: {
        decision: "block",
        code: firstBlockedPolicy?.code ?? "no_model_visible_tools",
        reason: firstBlockedPolicy?.reason ?? "No model-visible tools are enabled for this agent.",
      },
    };
  }

  const runtimeTools =
    pack && runtime?.runnable
      ? Object.fromEntries(
          allowedGeneric.map((binding) => [
            modelToolKey(binding.id),
            buildRuntimeModelTool({
              binding,
              env,
              identity,
              membership,
              pack,
              runtimeVersion: runtime.runtimeVersion,
              request: input,
            }),
          ]),
        )
      : {};

  return {
    exposure: {
      decision: "allow",
      code: "allowed",
      reason:
        allowedGeneric.length > 0
          ? `${allowedGeneric.length + (allowUrl ? 1 : 0)} model-visible runtime tool(s) are enabled.`
          : (urlExposurePolicy?.reason ?? "Model-visible tools are enabled."),
    },
    tools: {
      ...runtimeTools,
      ...(allowUrl
        ? {
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
                const toolCall =
                  latestToolCalls.find((call) => call.id === finished.toolCallId) ?? null;
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
          }
        : {}),
    },
  };
};
