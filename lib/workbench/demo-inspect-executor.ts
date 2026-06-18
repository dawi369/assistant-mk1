import type { Id, TenantScope } from "@/lib/agent-framework/contracts";
import { executeRegisteredTool } from "@/lib/agent-framework/tool-runtime";
import { signFacadeRequest } from "@/lib/workbench/control-plane-signing";
import {
  type DemoInspectInput,
  type DemoInspectOutput,
  DEMO_INSPECT_TOOL_NAME,
  workbenchToolRegistry,
} from "@/lib/workbench/tool-registry";

export type DemoInspectExecutorRequest = {
  runId?: string;
  workflowIntentId?: string;
  scope?: Partial<TenantScope>;
  agentId?: Id;
  callbackUrl?: string;
  callbackToken?: string;
  callbackSigningSecret?: string;
};

type ValidatedDemoInspectExecutorRequest = {
  runId: string;
  workflowIntentId: string;
  scope: TenantScope;
  agentId: Id;
  callbackUrl: string;
  callbackSigningSecret: string;
};

type DemoInspectCallbackInput = Pick<
  ValidatedDemoInspectExecutorRequest,
  "runId" | "workflowIntentId" | "callbackUrl" | "callbackSigningSecret"
> & {
  event: "run.started" | "run.completed" | "run.failed";
  output?: DemoInspectOutput;
  outputSummary?: string;
  summary?: string;
  error?: string;
};

export const validateDemoInspectExecutorRequest = (
  body: DemoInspectExecutorRequest,
): { ok: true; request: ValidatedDemoInspectExecutorRequest } | { ok: false; error: string } => {
  const userId = body.scope?.userId?.trim();
  const workspaceId = body.scope?.workspaceId?.trim();
  const agentId = body.agentId?.trim();

  if (!body.runId || !body.workflowIntentId || !body.callbackUrl || !body.callbackSigningSecret) {
    return {
      ok: false,
      error: "runId, workflowIntentId, callbackUrl, and callbackSigningSecret are required",
    };
  }

  if (!userId || !workspaceId || !agentId) {
    return {
      ok: false,
      error: "scope.userId, scope.workspaceId, and agentId are required",
    };
  }

  return {
    ok: true,
    request: {
      runId: body.runId,
      workflowIntentId: body.workflowIntentId,
      callbackUrl: body.callbackUrl,
      callbackSigningSecret: body.callbackSigningSecret,
      scope: { userId, workspaceId },
      agentId,
    },
  };
};

const execution = { mode: "dry_run" as const, policy: "dev-demo" };

const postCallback = async (input: DemoInspectCallbackInput) => {
  const body = JSON.stringify({
    runId: input.runId,
    workflowIntentId: input.workflowIntentId,
    event: input.event,
    output: input.output,
    outputSummary: input.outputSummary,
    summary: input.summary,
    error: input.error,
  });
  const url = new URL(input.callbackUrl);
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  Object.assign(
    headers,
    await signFacadeRequest({
      secret: input.callbackSigningSecret,
      method: "POST",
      pathWithQuery: `${url.pathname}${url.search}`,
      body,
      headers,
    }),
  );

  const response = await fetch(input.callbackUrl, {
    method: "POST",
    headers,
    body,
  });

  if (!response.ok) {
    throw new Error(
      `Callback ${input.event} failed with ${response.status}: ${await response.text()}`,
    );
  }
};

export const executeDemoInspectExecutorRequest = async (
  request: ValidatedDemoInspectExecutorRequest,
) => {
  const callbackInput = {
    runId: request.runId,
    workflowIntentId: request.workflowIntentId,
    callbackUrl: request.callbackUrl,
    callbackSigningSecret: request.callbackSigningSecret,
  };

  await postCallback({
    ...callbackInput,
    event: "run.started",
    summary: "Workbench executor started demo.inspect.",
  });

  const result = await executeRegisteredTool<DemoInspectInput, DemoInspectOutput>(
    workbenchToolRegistry,
    {
      toolName: DEMO_INSPECT_TOOL_NAME,
      input: { target: "workspace" },
      context: {
        scope: request.scope,
        execution,
        workflowIntentId: request.workflowIntentId,
      },
    },
  );

  if (!result.ok) {
    await postCallback({
      ...callbackInput,
      event: "run.failed",
      summary: "demo.inspect failed in the workbench executor.",
      error: result.error.message,
    });
    return { ok: false };
  }

  await postCallback({
    ...callbackInput,
    event: "run.completed",
    output: result.output,
    outputSummary: result.output.summary,
    summary: "demo.inspect completed in the workbench executor.",
  });

  return { ok: true };
};
