import {
  assertSchemaValue,
  defaultActionPort,
  defaultConnectionPort,
  type AgentExecutionContext,
  type RuntimeResult,
  type RuntimeToolBinding,
  type RuntimeWorkflowBinding,
} from "@assistant-mk1/agent-sdk/control-plane";

import { packWorkflowBindings, resolvePackRuntime } from "../../../lib/agent-runtime/registry";
import { resolveAgentBehaviorConfig } from "./agent-records";
import { selectAgent } from "./authz-store";
import { appendControlPlaneEvent } from "./control-plane-events";
import { isRecord, json, parseJson } from "./http";
import { upsertManagedState } from "./managed-state";
import {
  finishPackWorkflowRun,
  recordPackWorkflowToolCall,
  startPackWorkflowRun,
} from "./pack-workflow-lifecycle";
import type { WorkflowInvocationContext } from "./pack-workflow-runtime";
import { invokeFlyToolRunner, noEgressSandboxContract, runnerMetadataFor } from "./tool-runner";
import type { AgentIdentity, Env } from "./types";
import { authorizeWorkflowTools } from "./workflow-tool-policy";

const runtimeError = (code: string, message: string, status = 400) =>
  json(
    {
      ok: false,
      error: message,
      details: { code, message, retryable: false, redacted: true },
    },
    { status },
  );

const failure = (error: unknown): RuntimeResult => ({
  ok: false,
  error: {
    code:
      error && typeof error === "object" && "code" in error && typeof error.code === "string"
        ? error.code
        : "runtime_execution_failed",
    message: error instanceof Error ? error.message : "Runtime execution failed.",
    retryable: false,
    redacted: true,
  },
  summary: error instanceof Error ? error.message : "Runtime execution failed.",
});

const toolResult = (value: unknown): RuntimeResult => {
  if (value && typeof value === "object" && "ok" in value && typeof value.ok === "boolean") {
    return value as RuntimeResult;
  }
  return failure(
    Object.assign(new Error("Runtime tool returned an invalid result."), {
      code: "runtime_result_invalid",
    }),
  );
};

export const handleGenericRuntimeWorkflow = async (
  workflowType: string,
  request: Request,
  env: Env,
  identity: AgentIdentity,
  invocation: WorkflowInvocationContext,
) => {
  const binding = packWorkflowBindings[workflowType];
  if (!binding) return runtimeError("workflow_not_found", "Workflow not found.", 404);
  const agent = await selectAgent(env, identity.agentId, identity.scope.workspaceId);
  const pack = resolveAgentBehaviorConfig(agent).pack;
  if (!pack || pack.id !== binding.requiredPackId) {
    return runtimeError(
      "pack_required",
      `${workflowType} requires the active ${binding.requiredPackId} pack.`,
      403,
    );
  }
  const runtime = resolvePackRuntime(pack.id, pack.version);
  if (!runtime.runnable) {
    return runtimeError(
      "runtime_incompatible",
      "This agent snapshot can chat, but its workflows require a compatible runtime upgrade.",
      409,
    );
  }
  const workflow = runtime.controlPlane.workflows.find(
    (candidate) => candidate.type === workflowType,
  ) as RuntimeWorkflowBinding | undefined;
  if (!workflow?.execute) {
    return runtimeError(
      "workflow_binding_unavailable",
      "Workflow implementation is unavailable.",
      409,
    );
  }
  const body = parseJson(await request.text());
  if (!isRecord(body)) return runtimeError("invalid_input", "Body must be an object.");
  if (body.executionMode !== undefined && body.executionMode !== "dry_run") {
    return runtimeError("unsupported_execution_mode", "Only dry_run is supported.");
  }
  const rawInput = isRecord(body.input) ? body.input : body;
  const input = workflow.normalizeInput ? workflow.normalizeInput(rawInput) : rawInput;
  try {
    assertSchemaValue(workflow.inputSchema, input, `${workflowType} input`);
  } catch (error) {
    return runtimeError(
      "schema_validation_failed",
      error instanceof Error ? error.message : "Workflow input is invalid.",
    );
  }
  for (const toolId of workflow.toolIds) {
    const tool =
      runtime.controlPlane.tools.find((candidate) => candidate.id === toolId) ??
      runtime.runner.tools.find((candidate) => candidate.id === toolId);
    if (!tool) {
      return runtimeError(
        "tool_binding_unavailable",
        `Workflow tool ${toolId} is not registered.`,
        409,
      );
    }
    const authorization = await authorizeWorkflowTools(env, identity, {
      toolNames: [toolId],
      executionMode: "dry_run",
      requestedRuntimeMs: tool.timeoutMs,
      requestedArtifactBytes: tool.maxArtifactBytes,
    });
    if (!authorization.ok) return authorization.response;
  }

  const active = await env.DB.prepare(
    `SELECT COUNT(*) AS count
     FROM control_runs
     WHERE user_id = ? AND workspace_id = ? AND agent_id = ?
       AND status IN ('queued', 'running', 'waiting', 'interrupted')
       AND json_extract(data_json, '$.packId') = ?`,
  )
    .bind(identity.scope.userId, identity.scope.workspaceId, identity.agentId, pack.id)
    .first<{ count: number }>();
  if ((active?.count ?? 0) >= pack.resourceLimits.maxConcurrentRuns) {
    return runtimeError("concurrency_limit_exceeded", "The pack concurrency limit is active.", 429);
  }

  const started = await startPackWorkflowRun(env, identity, {
    workflowType,
    policyReference: `runtime:${pack.id}:${runtime.runtimeVersion}`,
    displayName: workflow.label,
    packId: pack.id,
    toolInput: input,
    executionMode: "dry_run",
    engine: workflow.engine,
    invocation,
    runtimeMetadata: {
      packVersion: pack.version,
      runtimeVersion: runtime.runtimeVersion,
      bindingVersion: 1,
      transports: Array.from(
        new Set(
          workflow.toolIds.map((toolId) => {
            const inline = runtime.controlPlane.tools.find((tool) => tool.id === toolId);
            const runner = runtime.runner.tools.find((tool) => tool.id === toolId);
            return (inline ?? runner)?.transport ?? "unknown";
          }),
        ),
      ),
    },
  });
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error("runtime_timeout")),
    pack.resourceLimits.maxRunSeconds * 1_000,
  );
  let calls = 0;

  const invokeTool = async (toolId: string, toolInput: Record<string, unknown>) => {
    calls += 1;
    if (calls > pack.resourceLimits.maxToolCallsPerRun) {
      return failure(
        Object.assign(new Error("Tool-call limit exceeded."), {
          code: "tool_call_limit_exceeded",
        }),
      );
    }
    const inline = runtime.controlPlane.tools.find((tool) => tool.id === toolId);
    const runnerTool = runtime.runner.tools.find((tool) => tool.id === toolId);
    const tool: RuntimeToolBinding | undefined = inline ?? runnerTool;
    if (!tool) {
      return failure(
        Object.assign(new Error(`Tool ${toolId} is not registered.`), {
          code: "tool_binding_unavailable",
        }),
      );
    }
    let result: RuntimeResult;
    try {
      assertSchemaValue(tool.inputSchema, toolInput, `${toolId} input`);
      if (tool.transport === "cloudflare_inline" && tool.execute) {
        result = toolResult(await tool.execute(toolInput, context));
      } else if (tool.transport === "fly" && runnerTool) {
        const runner = runnerMetadataFor(
          {
            toolName: tool.id,
            adapterVersion: tool.adapterVersion,
            supportedExecutionModes: [...tool.executionModes],
            transport: "fly",
          },
          "agent-pack",
          "fly",
          noEgressSandboxContract({
            template: tool.adapterVersion,
            maxRuntimeMs: tool.timeoutMs,
            maxArtifactBytes: tool.maxArtifactBytes,
          }),
        );
        result = toolResult(
          await invokeFlyToolRunner(env, identity, {
            scope: identity.scope,
            agentId: identity.agentId,
            runId: started.runId,
            workflowIntentId: started.workflowIntentId,
            toolName: tool.id,
            execution: { mode: "dry_run", policy: tool.policy.reference },
            input: toolInput,
            runner,
            source: "agent-pack",
          }),
        );
      } else {
        result = failure(
          Object.assign(new Error(`Tool ${toolId} has no executable binding.`), {
            code: "tool_binding_unavailable",
          }),
        );
      }
      if (result.ok) assertSchemaValue(tool.outputSchema, result.output, `${toolId} output`);
    } catch (error) {
      result = failure(error);
    }
    await recordPackWorkflowToolCall(env, identity, {
      ...started,
      toolName: toolId,
      status: result.ok ? "completed" : "failed",
      inputSummary: `Invoke ${toolId}`,
      outputSummary: result.summary,
      data: {
        packId: pack.id,
        packVersion: pack.version,
        runtimeVersion: runtime.runtimeVersion,
        adapterVersion: tool.adapterVersion,
        transport: tool.transport,
        ...(result.ok ? { output: result.output } : { error: result.error }),
      },
    });
    return result;
  };

  const context: AgentExecutionContext = {
    scope: { ...identity.scope, agentId: identity.agentId },
    pack: { id: pack.id, version: pack.version, runtimeVersion: runtime.runtimeVersion },
    run: {
      id: started.runId,
      workflowIntentId: started.workflowIntentId,
      executionMode: "dry_run",
      source: invocation.source === "trigger" ? "trigger" : "user",
    },
    signal: controller.signal,
    connections: defaultConnectionPort(pack.connections),
    actions: defaultActionPort,
    tools: { invoke: invokeTool },
    managedState: {
      async upsert(state) {
        const result = await upsertManagedState(env, identity, {
          id: `${identity.agentId}-${state.namespace}-${state.stateType}-${state.stateKey}`,
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
        await appendControlPlaneEvent(env, identity, {
          type,
          summary,
          targetType: "run",
          targetId: started.runId,
          data: { runId: started.runId, runtimeVersion: runtime.runtimeVersion, ...data },
        });
      },
    },
  };

  let result: RuntimeResult;
  try {
    result = toolResult(await workflow.execute(input, context));
    if (result.ok)
      assertSchemaValue(workflow.outputSchema, result.output, `${workflowType} output`);
  } catch (error) {
    result = failure(error);
  } finally {
    clearTimeout(timeout);
  }
  const artifact = result.artifacts?.[0];
  const artifactBytes = artifact ? JSON.stringify(artifact.data).length : 0;
  if (artifactBytes > pack.resourceLimits.maxArtifactBytes) {
    result = failure(
      Object.assign(new Error("Artifact limit exceeded."), {
        code: "artifact_limit_exceeded",
      }),
    );
  }
  const artifactId = artifact ? `${started.runId}-${artifact.kind}` : null;
  const finished = await finishPackWorkflowRun(env, identity, {
    ...started,
    workflowType,
    ok: result.ok,
    summary: result.summary,
    artifact:
      result.ok && artifact && artifactId
        ? {
            id: artifactId,
            kind: artifact.kind,
            uri: `d1://control-plane/${started.runId}/${artifact.kind}.json`,
            title: artifact.title,
            mimeType: artifact.mimeType,
            sizeBytes: artifactBytes,
            data: artifact.data,
          }
        : undefined,
    data: {
      packId: pack.id,
      packVersion: pack.version,
      runtimeVersion: runtime.runtimeVersion,
      workflowType,
      toolCallCount: calls,
      ...(result.ok ? { output: result.output } : { error: result.error }),
    },
  });
  if (!finished.applied) {
    return runtimeError(
      "run_terminal",
      "Run output was discarded because publication authority was revoked.",
      409,
    );
  }
  return json(
    {
      ok: result.ok,
      run: {
        id: started.runId,
        workflowIntentId: started.workflowIntentId,
        status: result.ok ? "completed" : "failed",
        engine: workflow.engine,
        workflowType,
        runtimeVersion: runtime.runtimeVersion,
      },
      ...(artifactId ? { artifact: { id: artifactId, kind: artifact?.kind } } : {}),
      ...(result.ok ? { report: result.output } : { error: result.error.message }),
    },
    { status: result.ok ? 201 : 502 },
  );
};
