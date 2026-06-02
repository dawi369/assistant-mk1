import { NextResponse, type NextRequest } from "next/server";

import type { Id, TenantScope } from "@/lib/agent-framework/contracts";
import { executeRegisteredTool } from "@/lib/agent-framework/tool-runtime";
import {
  type DemoInspectInput,
  type DemoInspectOutput,
  DEMO_INSPECT_TOOL_NAME,
  workbenchToolRegistry,
} from "@/lib/workbench/tool-registry";

export const runtime = "nodejs";

type ExecutorRequest = {
  runId?: string;
  workflowIntentId?: string;
  scope?: Partial<TenantScope>;
  agentId?: Id;
  callbackUrl?: string;
  callbackToken?: string;
};

const execution = { mode: "dry_run" as const, policy: "dev-demo" };

const readRequest = async (request: NextRequest): Promise<ExecutorRequest> => {
  try {
    return (await request.json()) as ExecutorRequest;
  } catch {
    return {};
  }
};

const readExecutorIdentity = (body: ExecutorRequest) => {
  const userId = body.scope?.userId?.trim();
  const workspaceId = body.scope?.workspaceId?.trim();
  const agentId = body.agentId?.trim();

  if (!userId || !workspaceId || !agentId) {
    return null;
  }

  return {
    scope: { userId, workspaceId },
    agentId,
  };
};

const postCallback = async (
  input: Required<
    Pick<ExecutorRequest, "runId" | "workflowIntentId" | "callbackUrl" | "callbackToken">
  > & {
    event: "run.started" | "run.completed" | "run.failed";
    output?: DemoInspectOutput;
    outputSummary?: string;
    summary?: string;
    error?: string;
  },
) => {
  const response = await fetch(input.callbackUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.callbackToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      runId: input.runId,
      workflowIntentId: input.workflowIntentId,
      event: input.event,
      output: input.output,
      outputSummary: input.outputSummary,
      summary: input.summary,
      error: input.error,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Callback ${input.event} failed with ${response.status}: ${await response.text()}`,
    );
  }
};

export async function POST(request: NextRequest) {
  const token = process.env.WORKBENCH_EXECUTOR_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "WORKBENCH_EXECUTOR_TOKEN is not configured" },
      { status: 500 },
    );
  }

  if (request.headers.get("authorization") !== `Bearer ${token}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await readRequest(request);
  if (!body.runId || !body.workflowIntentId || !body.callbackUrl || !body.callbackToken) {
    return NextResponse.json(
      { error: "runId, workflowIntentId, callbackUrl, and callbackToken are required" },
      { status: 400 },
    );
  }
  const identity = readExecutorIdentity(body);
  if (!identity) {
    return NextResponse.json(
      { error: "scope.userId, scope.workspaceId, and agentId are required" },
      { status: 400 },
    );
  }

  const callbackInput = {
    runId: body.runId,
    workflowIntentId: body.workflowIntentId,
    callbackUrl: body.callbackUrl,
    callbackToken: body.callbackToken,
  };

  await postCallback({
    ...callbackInput,
    event: "run.started",
    summary: "Next workbench executor started demo.inspect.",
  });

  const result = await executeRegisteredTool<DemoInspectInput, DemoInspectOutput>(
    workbenchToolRegistry,
    {
      toolName: DEMO_INSPECT_TOOL_NAME,
      input: { target: "workspace" },
      context: {
        scope: identity.scope,
        execution,
        workflowIntentId: body.workflowIntentId,
      },
    },
  );

  if (!result.ok) {
    await postCallback({
      ...callbackInput,
      event: "run.failed",
      summary: "demo.inspect failed in the Next workbench executor.",
      error: result.error.message,
    });
    return NextResponse.json({ ok: false });
  }

  await postCallback({
    ...callbackInput,
    event: "run.completed",
    output: result.output,
    outputSummary: result.output.summary,
    summary: "demo.inspect completed in the Next workbench executor.",
  });

  return NextResponse.json({ ok: true });
}
