import {
  createQueuedDemoRun,
  getControlRunSnapshot,
  markControlRunFailed,
  readLatestControlRun,
} from "./demo-run-store";
import { json } from "./http";
import {
  type AgentIdentity,
  type Env,
  type TenantScope,
  type WorkerExecutionContext,
} from "./types";

const dispatchDemoExecutor = async (
  env: Env,
  identity: AgentIdentity,
  origin: string,
  runId: string,
  workflowIntentId: string,
) => {
  const callbackSigningSecret =
    env.WORKBENCH_CALLBACK_SIGNING_SECRET?.trim() ||
    env.CLOUDFLARE_CONTROL_PLANE_FACADE_SIGNING_SECRET?.trim();
  if (!env.WORKBENCH_EXECUTOR_URL || !env.WORKBENCH_EXECUTOR_TOKEN || !callbackSigningSecret) {
    await markControlRunFailed(env, {
      ...identity,
      runId,
      workflowIntentId,
      summary: !callbackSigningSecret
        ? "Workbench callback signing is not configured."
        : "Workbench executor is not configured.",
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
        callbackUrl: `${origin}/workbench/run-callbacks`,
        callbackSigningSecret,
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
