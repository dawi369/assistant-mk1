import { selectMembership } from "./authz-store";
import { appendControlPlaneEvent } from "./control-plane-events";
import { appendControlAudit } from "./demo-run-store";
import { json, parseDataJson } from "./http";
import { requireActiveMembership } from "./membership-policy";
import { handlePolymancerMarketResearch } from "./polymancer-workflows";
import { dispatchWorkbenchSessionEvent } from "./session-coordinator";
import { handleSwordfishRuntimeResearch } from "./swordfish-workflows";
import { toJson, type AgentIdentity, type ControlRunRow, type D1Result, type Env } from "./types";

type ControllableRunRow = ControlRunRow & {
  workflow_type: string | null;
  payload_json: string | null;
};

type RetryWorkflowHandler = (
  request: Request,
  env: Env,
  identity: AgentIdentity,
) => Promise<Response>;

export type RunRetryHandlers = {
  polymancer: RetryWorkflowHandler;
  swordfish: RetryWorkflowHandler;
};

const defaultRetryHandlers: RunRetryHandlers = {
  polymancer: handlePolymancerMarketResearch,
  swordfish: handleSwordfishRuntimeResearch,
};

const selectControllableRun = (env: Env, identity: AgentIdentity, runId: string) =>
  env.DB.prepare(
    `SELECT r.id, r.user_id, r.workspace_id, r.agent_id, r.workflow_intent_id, r.status,
            r.execution_json, r.stage, r.engine, r.heartbeat_at, r.last_event_at,
            r.completed_at, r.failed_at, r.data_json, r.created_at, r.updated_at,
            i.type AS workflow_type, i.payload_json
     FROM control_runs r
     LEFT JOIN control_workflow_intents i
       ON i.user_id = r.user_id
      AND i.workspace_id = r.workspace_id
      AND i.id = r.workflow_intent_id
     WHERE r.user_id = ? AND r.workspace_id = ? AND r.id = ?
     LIMIT 1`,
  )
    .bind(identity.scope.userId, identity.scope.workspaceId, runId)
    .first<ControllableRunRow>();

const requireRunMember = async (env: Env, identity: AgentIdentity) => {
  const membership = await selectMembership(env, identity.scope.userId, identity.scope.workspaceId);
  return requireActiveMembership(membership);
};

export const handleCancelExecutionRun = async (
  env: Env,
  identity: AgentIdentity,
  runId: string,
) => {
  const membershipError = await requireRunMember(env, identity);
  if (membershipError) return membershipError;

  const run = await selectControllableRun(env, identity, runId);
  if (!run) return json({ ok: false, error: "Run not found" }, { status: 404 });
  if (run.status !== "queued" && run.status !== "running" && run.status !== "waiting") {
    return json(
      { ok: false, error: "Run cannot be cancelled in its current state" },
      { status: 409 },
    );
  }

  const timestamp = new Date().toISOString();
  const data = parseDataJson(run.data_json);
  const cancelResult = (await env.DB.prepare(
    `UPDATE control_runs
     SET status = 'cancelled', last_event_at = ?, completed_at = ?, data_json = ?, updated_at = ?
     WHERE user_id = ? AND workspace_id = ? AND id = ?
       AND status IN ('queued', 'running', 'waiting')`,
  )
    .bind(
      timestamp,
      timestamp,
      toJson({
        ...data,
        summary: "Cancelled by the user.",
        cancelledByUserId: identity.scope.userId,
      }),
      timestamp,
      identity.scope.userId,
      identity.scope.workspaceId,
      run.id,
    )
    .run()) as D1Result;
  if (cancelResult.meta?.changes === 0) {
    return json(
      { ok: false, error: "Run cannot be cancelled in its current state" },
      { status: 409 },
    );
  }

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE control_workflow_intents
       SET status = 'cancelled', updated_at = ?
       WHERE user_id = ? AND workspace_id = ? AND id = ?`,
    ).bind(timestamp, identity.scope.userId, identity.scope.workspaceId, run.workflow_intent_id),
    env.DB.prepare(
      `UPDATE control_tool_calls
       SET status = 'cancelled', finished_at = ?
       WHERE user_id = ? AND workspace_id = ? AND run_id = ? AND status = 'running'`,
    ).bind(timestamp, identity.scope.userId, identity.scope.workspaceId, run.id),
  ]);

  const summary = "Cancelled run.";
  await appendControlAudit(env, {
    ...identity,
    runId: run.id,
    workflowIntentId: run.workflow_intent_id,
    action: "run.cancelled",
    summary,
    targetType: "run",
    targetId: run.id,
  });
  await appendControlPlaneEvent(env, identity, {
    type: "run.cancelled",
    summary,
    targetType: "run",
    targetId: run.id,
    data: { runId: run.id, workflowIntentId: run.workflow_intent_id },
  });
  await dispatchWorkbenchSessionEvent(env, identity, {
    type: "workflow.run.updated",
    data: { runId: run.id, workflowIntentId: run.workflow_intent_id, status: "cancelled" },
  });

  return json({ ok: true, run: { id: run.id, status: "cancelled" } });
};

export const handleRetryExecutionRun = async (
  request: Request,
  env: Env,
  identity: AgentIdentity,
  runId: string,
  handlers: RunRetryHandlers = defaultRetryHandlers,
) => {
  const membershipError = await requireRunMember(env, identity);
  if (membershipError) return membershipError;

  const run = await selectControllableRun(env, identity, runId);
  if (!run) return json({ ok: false, error: "Run not found" }, { status: 404 });
  if (run.status !== "failed" && run.status !== "cancelled") {
    return json(
      { ok: false, error: "Only failed or cancelled runs can be retried" },
      { status: 409 },
    );
  }

  const payload = run.payload_json ? parseDataJson(run.payload_json) : {};
  const retryRequest = new Request(request.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      input: payload.input ?? payload,
      executionMode: "dry_run",
    }),
  });
  const retryIdentity = { ...identity, agentId: run.agent_id };
  const response =
    run.workflow_type === "polymancer.market_research"
      ? await handlers.polymancer(retryRequest, env, retryIdentity)
      : run.workflow_type === "swordfish.runtime_research"
        ? await handlers.swordfish(retryRequest, env, retryIdentity)
        : null;
  if (!response) {
    return json({ ok: false, error: "This run type does not support retry" }, { status: 409 });
  }

  const body = (await response
    .clone()
    .json()
    .catch(() => null)) as {
    run?: { runId?: string; id?: string; workflowIntentId?: string };
  } | null;
  const retriedRunId = body?.run?.runId ?? body?.run?.id;
  if (retriedRunId) {
    await env.DB.prepare(
      `UPDATE control_runs
       SET data_json = json_set(data_json, '$.retryOfRunId', ?)
       WHERE user_id = ? AND workspace_id = ? AND id = ?`,
    )
      .bind(run.id, identity.scope.userId, identity.scope.workspaceId, retriedRunId)
      .run();
    await appendControlAudit(env, {
      ...identity,
      runId: retriedRunId,
      workflowIntentId: body?.run?.workflowIntentId ?? "",
      action: "run.retried",
      summary: `Retried ${run.id}.`,
      targetType: "run",
      targetId: retriedRunId,
      data: { retryOfRunId: run.id },
    });
  }
  return response;
};
