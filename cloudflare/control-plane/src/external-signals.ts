import { Client } from "@langchain/langgraph-sdk";

import { appendControlPlaneEvent } from "./control-plane-events";
import { appendControlAudit } from "./demo-run-store";
import { isRecord, json, parseJson } from "./http";
import {
  normalizeExternalSignal,
  type ExternalSignalPayload,
} from "../../../lib/workbench/schedule-dispatch";
import { createId, toJson, type AgentIdentity, type Env } from "./types";

const externalSignalPolicy = "external-signal-intent-v0";
const externalSignalWorkflowType = "external.signal";

const assistantIdFor = (env: Env, requested?: string) =>
  requested?.trim() || env.LANGGRAPH_ASSISTANT_ID?.trim() || "agent";

const getLangGraphClient = (env: Env) => {
  const apiUrl = env.LANGGRAPH_UPSTREAM_URL?.trim();
  if (!apiUrl) throw new Error("LANGGRAPH_UPSTREAM_URL is not configured");
  return new Client({
    apiUrl,
    apiKey: env.LANGGRAPH_UPSTREAM_TOKEN,
  });
};

const createExternalSignalControlRun = async (
  env: Env,
  identity: AgentIdentity,
  input: {
    action: string;
    payload: Record<string, unknown>;
    assistantId: string;
  },
) => {
  const timestamp = new Date().toISOString();
  const workflowIntentId = createId("cf-intent");
  const runId = createId("cf-run");
  const execution = { mode: "dry_run", policy: externalSignalPolicy };
  const payload = {
    action: input.action,
    assistantId: input.assistantId,
    externalSignal: input.payload,
  };

  await env.DB.prepare(
    `INSERT INTO control_workflow_intents (
       id, user_id, workspace_id, agent_id, stage, type, execution_json, payload_json,
       status, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      workflowIntentId,
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.agentId,
      "observe",
      externalSignalWorkflowType,
      toJson(execution),
      toJson(payload),
      "running",
      timestamp,
      timestamp,
    )
    .run();

  await env.DB.prepare(
    `INSERT INTO control_runs (
       id, user_id, workspace_id, agent_id, workflow_intent_id, status, execution_json,
       stage, engine, heartbeat_at, last_event_at, data_json, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      runId,
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.agentId,
      workflowIntentId,
      "queued",
      toJson(execution),
      "observe",
      "langgraph",
      timestamp,
      timestamp,
      toJson({
        displayName: "External signal",
        action: input.action,
        assistantId: input.assistantId,
      }),
      timestamp,
      timestamp,
    )
    .run();

  await appendControlAudit(env, {
    ...identity,
    runId,
    workflowIntentId,
    action: "intent.created",
    summary: `Accepted external signal: ${input.action}.`,
    targetType: "workflowIntent",
    targetId: workflowIntentId,
    data: { action: input.action, assistantId: input.assistantId },
  });
  await appendControlPlaneEvent(env, identity, {
    type: "external_signal.accepted",
    summary: `Accepted external signal: ${input.action}.`,
    targetType: "workflowIntent",
    targetId: workflowIntentId,
    data: { runId, workflowIntentId, action: input.action, assistantId: input.assistantId },
  });

  return { runId, workflowIntentId, intentId: workflowIntentId };
};

const updateExternalSignalControlRun = async (
  env: Env,
  identity: AgentIdentity,
  input: {
    runId: string;
    workflowIntentId: string;
    status: "queued" | "failed";
    summary: string;
    data?: Record<string, unknown>;
  },
) => {
  const timestamp = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE control_runs
       SET status = ?, last_event_at = ?, failed_at = ?, data_json = ?, updated_at = ?
       WHERE user_id = ? AND workspace_id = ? AND id = ?`,
    ).bind(
      input.status,
      timestamp,
      input.status === "failed" ? timestamp : null,
      toJson({ summary: input.summary, ...input.data }),
      timestamp,
      identity.scope.userId,
      identity.scope.workspaceId,
      input.runId,
    ),
    env.DB.prepare(
      `UPDATE control_workflow_intents
       SET status = ?, updated_at = ?
       WHERE user_id = ? AND workspace_id = ? AND id = ?`,
    ).bind(
      input.status === "failed" ? "failed" : "running",
      timestamp,
      identity.scope.userId,
      identity.scope.workspaceId,
      input.workflowIntentId,
    ),
  ]);
  await appendControlAudit(env, {
    ...identity,
    runId: input.runId,
    workflowIntentId: input.workflowIntentId,
    action: input.status === "failed" ? "run.failed" : "run.queued",
    summary: input.summary,
    targetType: "run",
    targetId: input.runId,
    data: input.data,
  });
  await appendControlPlaneEvent(env, identity, {
    type: input.status === "failed" ? "run.failed" : "run.queued",
    summary: input.summary,
    targetType: "run",
    targetId: input.runId,
    data: { runId: input.runId, workflowIntentId: input.workflowIntentId, ...input.data },
  });
};

export const handleExternalSignal = async (request: Request, env: Env, identity: AgentIdentity) => {
  const body = parseJson(await request.text());
  if (!isRecord(body)) return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });

  const normalized = normalizeExternalSignal(body as ExternalSignalPayload);
  if (!normalized.ok) {
    return json({ ok: false, error: normalized.error }, { status: normalized.status });
  }

  const signal = normalized.signal;
  const assistantId = assistantIdFor(env, signal.assistantId);
  const controlPlane = await createExternalSignalControlRun(env, identity, {
    action: signal.action,
    assistantId,
    payload: signal as unknown as Record<string, unknown>,
  });

  try {
    const client = getLangGraphClient(env);
    if (signal.action === "create_cron") {
      const cron = await client.crons.create(assistantId, {
        schedule: signal.schedule ?? "",
        timezone: signal.timezone,
        input: signal.input,
        metadata: signal.metadata,
        webhook: signal.webhook,
      });
      await updateExternalSignalControlRun(env, identity, {
        ...controlPlane,
        status: "queued",
        summary: "External signal cron was registered through LangGraph.",
        data: { action: signal.action, cron },
      });
      return json({ cron, controlPlane });
    }

    const thread = signal.threadId
      ? await client.threads.get(signal.threadId)
      : await client.threads.create({ metadata: signal.metadata, graphId: assistantId });
    const run = await client.runs.create(thread.thread_id, assistantId, {
      input:
        signal.action === "start" || signal.action === "dispatch_schedule" ? signal.input : null,
      command: signal.action === "resume" ? (signal.command as never) : undefined,
      metadata: signal.metadata,
      webhook: signal.webhook,
      multitaskStrategy: "enqueue",
    });
    await updateExternalSignalControlRun(env, identity, {
      ...controlPlane,
      status: "queued",
      summary: "External signal run was queued through LangGraph.",
      data: {
        action: signal.action,
        upstreamThreadId: thread.thread_id,
        upstreamRunId: isRecord(run) && typeof run.run_id === "string" ? run.run_id : undefined,
        dispatch: signal.scheduleDispatch,
      },
    });
    return json({
      threadId: thread.thread_id,
      run,
      dispatch: signal.scheduleDispatch,
      controlPlane,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "External signal delegation failed";
    await updateExternalSignalControlRun(env, identity, {
      ...controlPlane,
      status: "failed",
      summary: message,
      data: { action: signal.action, error: message },
    });
    return json(
      {
        ok: false,
        error: message,
        controlPlane,
      },
      { status: 500 },
    );
  }
};
