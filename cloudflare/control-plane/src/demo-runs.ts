import {
  createQueuedDemoRun,
  getControlRunSnapshot,
  markControlRunFailed,
  readLatestControlRun,
  readStoredRunIdentity,
  recordDemoRunCompleted,
  recordDemoRunStarted,
} from "./demo-run-store";
import { isRecord, json } from "./http";
import type { AgentIdentity, Env, TenantScope, WorkerExecutionContext } from "./types";

type RunIdentity = {
  runId: string;
  workflowIntentId: string;
};

const dispatchDemoExecutor = async (
  env: Env,
  identity: AgentIdentity,
  origin: string,
  runId: string,
  workflowIntentId: string,
) => {
  if (!env.WORKBENCH_EXECUTOR_URL || !env.WORKBENCH_EXECUTOR_TOKEN) {
    await markControlRunFailed(env, {
      ...identity,
      runId,
      workflowIntentId,
      summary: "Workbench executor is not configured.",
    });
    return;
  }

  try {
    const response = await fetch(env.WORKBENCH_EXECUTOR_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.WORKBENCH_EXECUTOR_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        runId,
        workflowIntentId,
        scope: identity.scope,
        agentId: identity.agentId,
        callbackUrl: `${origin}/internal/workbench/run-callbacks`,
        callbackToken: env.CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN,
      }),
    });

    if (!response.ok) {
      await markControlRunFailed(env, {
        ...identity,
        runId,
        workflowIntentId,
        summary: "Workbench executor request failed.",
        error: `${response.status} ${await response.text()}`,
      });
    }
  } catch (error) {
    await markControlRunFailed(env, {
      ...identity,
      runId,
      workflowIntentId,
      summary: "Workbench executor request failed.",
      error: error instanceof Error ? error.message : "Unknown executor request failure",
    });
  }
};

const readCallbackBody = async (request: Request) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return {
      ok: false as const,
      response: json({ ok: false, error: "request body must be JSON" }, { status: 400 }),
    };
  }

  if (!isRecord(body)) {
    return {
      ok: false as const,
      response: json({ ok: false, error: "request body must be an object" }, { status: 400 }),
    };
  }

  const runId = body.runId;
  const workflowIntentId = body.workflowIntentId;
  if (typeof runId !== "string" || typeof workflowIntentId !== "string") {
    return {
      ok: false as const,
      response: json(
        { ok: false, error: "runId and workflowIntentId are required" },
        { status: 400 },
      ),
    };
  }

  return {
    ok: true as const,
    body,
    identity: { runId, workflowIntentId },
  };
};

export const handleStartCloudflareDemoRun = async (
  request: Request,
  env: Env,
  ctx: WorkerExecutionContext,
  identity: AgentIdentity,
) => {
  const { runId, workflowIntentId } = await createQueuedDemoRun(env, identity);

  ctx.waitUntil(
    dispatchDemoExecutor(env, identity, new URL(request.url).origin, runId, workflowIntentId),
  );

  return json(
    { ok: true, snapshot: await getControlRunSnapshot(env, identity.scope, runId) },
    { status: 201 },
  );
};

export const handleLatestCloudflareDemoRun = async (env: Env, scope: TenantScope) => {
  const run = await readLatestControlRun(env, scope);
  return json({
    ok: true,
    snapshot: run ? await getControlRunSnapshot(env, scope, run.id) : null,
  });
};

export const handleGetCloudflareDemoRun = async (env: Env, scope: TenantScope, runId: string) => {
  const snapshot = await getControlRunSnapshot(env, scope, runId);
  if (!snapshot) return json({ ok: false, error: "Demo run not found" }, { status: 404 });
  return json({ ok: true, snapshot });
};

const handleStartedCallback = async (env: Env, identity: AgentIdentity & RunIdentity) => {
  await recordDemoRunStarted(env, identity);
  return json({
    ok: true,
    snapshot: await getControlRunSnapshot(env, identity.scope, identity.runId),
  });
};

const handleCompletedCallback = async (
  env: Env,
  identity: AgentIdentity & RunIdentity,
  body: Record<string, unknown>,
) => {
  await recordDemoRunCompleted(env, {
    ...identity,
    output: isRecord(body.output) ? body.output : {},
    outputSummary: typeof body.outputSummary === "string" ? body.outputSummary : undefined,
  });
  return json({
    ok: true,
    snapshot: await getControlRunSnapshot(env, identity.scope, identity.runId),
  });
};

const handleFailedCallback = async (
  env: Env,
  identity: AgentIdentity & RunIdentity,
  body: Record<string, unknown>,
) => {
  await markControlRunFailed(env, {
    ...identity,
    summary: typeof body.summary === "string" ? body.summary : "Executor reported failure.",
    error: typeof body.error === "string" ? body.error : undefined,
  });
  return json({
    ok: true,
    snapshot: await getControlRunSnapshot(env, identity.scope, identity.runId),
  });
};

export const handleRunCallback = async (request: Request, env: Env) => {
  const parsed = await readCallbackBody(request);
  if (!parsed.ok) return parsed.response;

  const identity = await readStoredRunIdentity(env, parsed.identity);
  if (!identity) return json({ ok: false, error: "Demo run not found" }, { status: 404 });

  if (parsed.body.event === "run.started") {
    return handleStartedCallback(env, identity);
  }

  if (parsed.body.event === "run.completed") {
    return handleCompletedCallback(env, identity, parsed.body);
  }

  if (parsed.body.event === "run.failed") {
    return handleFailedCallback(env, identity, parsed.body);
  }

  return json({ ok: false, error: "unsupported callback event" }, { status: 400 });
};
