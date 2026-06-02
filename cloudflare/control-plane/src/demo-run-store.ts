import { parseDataJson, parseJson } from "./http";
import {
  createId,
  demoExecution,
  demoWorkflowType,
  fixtureAgentId,
  fixtureScope,
  toJson,
  type ControlArtifactRow,
  type ControlAuditRow,
  type ControlDecisionRow,
  type ControlIntentRow,
  type ControlRunRow,
  type ControlToolCallRow,
  type Env,
  type RunStatus,
} from "./types";

type ControlAuditInput = {
  runId: string;
  workflowIntentId: string;
  action: string;
  summary: string;
  targetType?: string;
  targetId?: string;
  data?: Record<string, unknown>;
};

type ControlRunStatusInput = {
  runId: string;
  workflowIntentId: string;
  status: RunStatus;
  summary?: string;
  data?: Record<string, unknown>;
};

type RunIdentity = {
  runId: string;
  workflowIntentId: string;
};

const toIntent = (row: ControlIntentRow) => ({
  id: row.id,
  scope: fixtureScope,
  agentId: row.agent_id,
  stage: row.stage,
  type: row.type,
  execution: parseDataJson(row.execution_json),
  payload: parseDataJson(row.payload_json),
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toRun = (row: ControlRunRow) => ({
  id: row.id,
  scope: fixtureScope,
  agentId: row.agent_id,
  workflowIntentId: row.workflow_intent_id,
  status: row.status,
  execution: parseDataJson(row.execution_json),
  stage: row.stage ?? undefined,
  engine: row.engine ?? undefined,
  heartbeatAt: row.heartbeat_at ?? undefined,
  lastEventAt: row.last_event_at ?? undefined,
  completedAt: row.completed_at ?? undefined,
  failedAt: row.failed_at ?? undefined,
  data: parseDataJson(row.data_json),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toToolCall = (row: ControlToolCallRow) => ({
  id: row.id,
  scope: fixtureScope,
  agentId: row.agent_id,
  workflowIntentId: row.workflow_intent_id,
  runId: row.run_id,
  toolId: row.tool_id,
  status: row.status,
  inputSummary: row.input_summary ?? undefined,
  outputSummary: row.output_summary ?? undefined,
  artifactRefs: parseJson(row.artifact_refs_json) ?? [],
  data: parseDataJson(row.data_json),
  startedAt: row.started_at,
  finishedAt: row.finished_at ?? undefined,
  createdAt: row.created_at,
});

const toArtifact = (row: ControlArtifactRow) => ({
  id: row.id,
  scope: fixtureScope,
  kind: row.kind,
  uri: row.uri,
  title: row.title ?? undefined,
  mimeType: row.mime_type ?? undefined,
  sizeBytes: row.size_bytes ?? undefined,
  data: parseDataJson(row.data_json),
  createdAt: row.created_at,
});

const toDecision = (row: ControlDecisionRow) => ({
  id: row.id,
  scope: fixtureScope,
  agentId: row.agent_id,
  title: row.title,
  summary: row.summary,
  thesis: row.thesis,
  status: row.status,
  provenanceRefs: parseJson(row.provenance_refs_json) ?? [],
  artifactRefs: parseJson(row.artifact_refs_json) ?? [],
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toAuditEvent = (row: ControlAuditRow) => ({
  id: row.id,
  scope: fixtureScope,
  actor: { type: "system", name: "Cloudflare Control Plane" },
  action: row.action,
  summary: row.summary,
  target:
    row.target_type && row.target_id ? { type: row.target_type, id: row.target_id } : undefined,
  data: parseDataJson(row.data_json),
  createdAt: row.created_at,
});

export const appendControlAudit = async (env: Env, input: ControlAuditInput) => {
  const timestamp = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO control_audit_events (
       id, user_id, workspace_id, action, summary, target_type, target_id, data_json, created_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      createId("cf-audit"),
      fixtureScope.userId,
      fixtureScope.workspaceId,
      input.action,
      input.summary,
      input.targetType,
      input.targetId,
      toJson({
        eventName: input.action,
        runId: input.runId,
        workflowIntentId: input.workflowIntentId,
        ...input.data,
      }),
      timestamp,
    )
    .run();
};

const readControlRun = async (env: Env, runId: string) =>
  env.DB.prepare(
    `SELECT id, user_id, workspace_id, agent_id, workflow_intent_id, status, execution_json,
            stage, engine, heartbeat_at, last_event_at, completed_at, failed_at, data_json,
            created_at, updated_at
     FROM control_runs
     WHERE user_id = ? AND workspace_id = ? AND id = ?
     LIMIT 1`,
  )
    .bind(fixtureScope.userId, fixtureScope.workspaceId, runId)
    .first<ControlRunRow>();

export const readLatestControlRun = async (env: Env) =>
  env.DB.prepare(
    `SELECT id, user_id, workspace_id, agent_id, workflow_intent_id, status, execution_json,
            stage, engine, heartbeat_at, last_event_at, completed_at, failed_at, data_json,
            created_at, updated_at
     FROM control_runs
     WHERE user_id = ? AND workspace_id = ?
     ORDER BY updated_at DESC, created_at DESC
     LIMIT 1`,
  )
    .bind(fixtureScope.userId, fixtureScope.workspaceId)
    .first<ControlRunRow>();

export const getControlRunSnapshot = async (env: Env, runId: string) => {
  const runRow = await readControlRun(env, runId);
  if (!runRow) return null;

  const intentRow = await env.DB.prepare(
    `SELECT id, user_id, workspace_id, agent_id, stage, type, execution_json, payload_json,
            status, created_at, updated_at
     FROM control_workflow_intents
     WHERE user_id = ? AND workspace_id = ? AND id = ?
     LIMIT 1`,
  )
    .bind(fixtureScope.userId, fixtureScope.workspaceId, runRow.workflow_intent_id)
    .first<ControlIntentRow>();

  const toolCalls = await env.DB.prepare(
    `SELECT id, user_id, workspace_id, agent_id, workflow_intent_id, run_id, tool_id, status,
            input_summary, output_summary, artifact_refs_json, data_json, started_at,
            finished_at, created_at
     FROM control_tool_calls
     WHERE user_id = ? AND workspace_id = ? AND run_id = ?
     ORDER BY created_at ASC`,
  )
    .bind(fixtureScope.userId, fixtureScope.workspaceId, runId)
    .all<ControlToolCallRow>();

  const artifacts = await env.DB.prepare(
    `SELECT id, user_id, workspace_id, kind, uri, title, mime_type, size_bytes, data_json, created_at
     FROM control_artifacts
     WHERE user_id = ? AND workspace_id = ? AND id LIKE ?
     ORDER BY created_at ASC`,
  )
    .bind(fixtureScope.userId, fixtureScope.workspaceId, `${runId}-%`)
    .all<ControlArtifactRow>();

  const decisions = await env.DB.prepare(
    `SELECT id, user_id, workspace_id, agent_id, title, summary, thesis, status,
            provenance_refs_json, artifact_refs_json, created_at, updated_at
     FROM control_decisions
     WHERE user_id = ? AND workspace_id = ? AND id LIKE ?
     ORDER BY created_at ASC`,
  )
    .bind(fixtureScope.userId, fixtureScope.workspaceId, `${runId}-%`)
    .all<ControlDecisionRow>();

  const auditEvents = await env.DB.prepare(
    `SELECT id, user_id, workspace_id, action, summary, target_type, target_id, data_json,
            created_at
     FROM control_audit_events
     WHERE user_id = ? AND workspace_id = ? AND json_extract(data_json, '$.runId') = ?
     ORDER BY created_at ASC`,
  )
    .bind(fixtureScope.userId, fixtureScope.workspaceId, runId)
    .all<ControlAuditRow>();

  return {
    scope: fixtureScope,
    intent: intentRow ? toIntent(intentRow) : null,
    run: toRun(runRow),
    toolCalls: toolCalls.results.map(toToolCall),
    artifacts: artifacts.results.map(toArtifact),
    decisions: decisions.results.map(toDecision),
    auditEvents: auditEvents.results.map(toAuditEvent),
  };
};

export const updateControlRunStatus = async (env: Env, input: ControlRunStatusInput) => {
  const timestamp = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE control_runs
     SET status = ?, heartbeat_at = ?, last_event_at = ?, completed_at = ?,
         failed_at = ?, data_json = ?, updated_at = ?
     WHERE user_id = ? AND workspace_id = ? AND id = ?`,
  )
    .bind(
      input.status,
      timestamp,
      timestamp,
      input.status === "completed" ? timestamp : null,
      input.status === "failed" ? timestamp : null,
      toJson({
        displayName: "Cloudflare-owned demo inspect",
        summary: input.summary,
        ...input.data,
      }),
      timestamp,
      fixtureScope.userId,
      fixtureScope.workspaceId,
      input.runId,
    )
    .run();

  await env.DB.prepare(
    `UPDATE control_workflow_intents
     SET status = ?, updated_at = ?
     WHERE user_id = ? AND workspace_id = ? AND id = ?`,
  )
    .bind(
      input.status,
      timestamp,
      fixtureScope.userId,
      fixtureScope.workspaceId,
      input.workflowIntentId,
    )
    .run();
};

export const markControlRunFailed = async (
  env: Env,
  input: { runId: string; workflowIntentId: string; summary: string; error?: string },
) => {
  await updateControlRunStatus(env, {
    runId: input.runId,
    workflowIntentId: input.workflowIntentId,
    status: "failed",
    summary: input.summary,
    data: { error: input.error },
  });
  await appendControlAudit(env, {
    runId: input.runId,
    workflowIntentId: input.workflowIntentId,
    action: "run.failed",
    summary: input.summary,
    targetType: "run",
    targetId: input.runId,
    data: { error: input.error },
  });
};

export const createQueuedDemoRun = async (env: Env): Promise<RunIdentity> => {
  const timestamp = new Date().toISOString();
  const workflowIntentId = createId("cf-intent");
  const runId = createId("cf-run");

  await env.DB.prepare(
    `INSERT INTO control_workflow_intents (
       id, user_id, workspace_id, agent_id, stage, type, execution_json, payload_json,
       status, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      workflowIntentId,
      fixtureScope.userId,
      fixtureScope.workspaceId,
      fixtureAgentId,
      "observe",
      demoWorkflowType,
      toJson(demoExecution),
      toJson({ target: "workspace", requestedBy: "cloudflare-control-plane" }),
      "queued",
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
      fixtureScope.userId,
      fixtureScope.workspaceId,
      fixtureAgentId,
      workflowIntentId,
      "queued",
      toJson(demoExecution),
      "observe",
      "cloudflare-control-plane",
      timestamp,
      timestamp,
      toJson({ displayName: "Cloudflare-owned demo inspect" }),
      timestamp,
      timestamp,
    )
    .run();

  await appendControlAudit(env, {
    runId,
    workflowIntentId,
    action: "intent.created",
    summary: "Created Cloudflare-owned demo.inspect workflow intent.",
    targetType: "workflowIntent",
    targetId: workflowIntentId,
  });
  await appendControlAudit(env, {
    runId,
    workflowIntentId,
    action: "run.queued",
    summary: "Queued Cloudflare-owned demo run.",
    targetType: "run",
    targetId: runId,
  });

  return { runId, workflowIntentId };
};

export const recordDemoRunStarted = async (env: Env, input: RunIdentity) => {
  const timestamp = new Date().toISOString();
  const toolCallId = `${input.runId}-tool-demo-inspect`;
  await updateControlRunStatus(env, {
    ...input,
    status: "running",
    summary: "Executor started Cloudflare-owned demo run.",
  });
  await env.DB.prepare(
    `INSERT INTO control_tool_calls (
       id, user_id, workspace_id, agent_id, workflow_intent_id, run_id, tool_id, status,
       input_summary, artifact_refs_json, data_json, started_at, created_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  )
    .bind(
      toolCallId,
      fixtureScope.userId,
      fixtureScope.workspaceId,
      fixtureAgentId,
      input.workflowIntentId,
      input.runId,
      demoWorkflowType,
      "running",
      "Inspect fixture workspace in dry-run mode.",
      "[]",
      toJson({ source: "next-workbench-executor" }),
      timestamp,
      timestamp,
    )
    .run();
  await appendControlAudit(env, {
    ...input,
    action: "run.started",
    summary: "Started Cloudflare-owned demo run.",
    targetType: "run",
    targetId: input.runId,
  });
  await appendControlAudit(env, {
    ...input,
    action: "tool.started",
    summary: "Started demo.inspect tool call.",
    targetType: "toolCall",
    targetId: toolCallId,
  });
};

export const recordDemoRunCompleted = async (
  env: Env,
  input: RunIdentity & { output: Record<string, unknown>; outputSummary?: string },
) => {
  const timestamp = new Date().toISOString();
  const toolCallId = `${input.runId}-tool-demo-inspect`;
  const artifactId = `${input.runId}-artifact-demo-inspect`;
  const decisionId = `${input.runId}-decision-demo-inspect`;
  const artifactRef = {
    id: artifactId,
    kind: "report",
    uri: `d1://control-plane/${input.runId}/inspect-report.json`,
    title: "Cloudflare-owned demo inspect report",
    mimeType: "application/json",
  };

  await env.DB.prepare(
    `INSERT INTO control_artifacts (
       id, user_id, workspace_id, kind, uri, title, mime_type, size_bytes, data_json, created_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json`,
  )
    .bind(
      artifactId,
      fixtureScope.userId,
      fixtureScope.workspaceId,
      "report",
      artifactRef.uri,
      artifactRef.title,
      artifactRef.mimeType,
      JSON.stringify(input.output).length,
      toJson({ output: input.output }),
      timestamp,
    )
    .run();
  await env.DB.prepare(
    `UPDATE control_tool_calls
     SET status = ?, output_summary = ?, artifact_refs_json = ?, data_json = ?, finished_at = ?
     WHERE id = ? AND user_id = ? AND workspace_id = ?`,
  )
    .bind(
      "completed",
      input.outputSummary ?? "demo.inspect completed.",
      toJson([artifactRef]),
      toJson({ output: input.output }),
      timestamp,
      toolCallId,
      fixtureScope.userId,
      fixtureScope.workspaceId,
    )
    .run();
  await env.DB.prepare(
    `INSERT INTO control_decisions (
       id, user_id, workspace_id, agent_id, title, summary, thesis, status,
       provenance_refs_json, artifact_refs_json, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`,
  )
    .bind(
      decisionId,
      fixtureScope.userId,
      fixtureScope.workspaceId,
      fixtureAgentId,
      "Cloudflare-owned demo inspect completed",
      "The Cloudflare-owned fixture run delegated execution and persisted callbacks.",
      "Assistant-MK1 can let Cloudflare own run coordination while Next/Fly executes work.",
      "active",
      toJson([
        {
          id: toolCallId,
          kind: "tool_result",
          title: "demo.inspect result",
          capturedAt: timestamp,
        },
      ]),
      toJson([artifactRef]),
      timestamp,
      timestamp,
    )
    .run();
  await appendControlAudit(env, {
    ...input,
    action: "tool.finished",
    summary: "Finished demo.inspect tool call.",
    targetType: "toolCall",
    targetId: toolCallId,
  });
  await appendControlAudit(env, {
    ...input,
    action: "artifact.created",
    summary: "Created Cloudflare-owned demo inspect artifact metadata.",
    targetType: "artifact",
    targetId: artifactId,
  });
  await appendControlAudit(env, {
    ...input,
    action: "decision.created",
    summary: "Created Cloudflare-owned demo decision record.",
    targetType: "decision",
    targetId: decisionId,
  });
  await updateControlRunStatus(env, {
    ...input,
    status: "completed",
    summary: "Cloudflare-owned demo run completed.",
    data: { artifactIds: [artifactId], decisionIds: [decisionId] },
  });
  await appendControlAudit(env, {
    ...input,
    action: "run.completed",
    summary: "Completed Cloudflare-owned demo run.",
    targetType: "run",
    targetId: input.runId,
  });
};
