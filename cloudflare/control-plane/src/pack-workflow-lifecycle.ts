import { appendControlPlaneEvent } from "./control-plane-events";
import { appendControlAudit } from "./demo-run-store";
import { buildControlRunRelation, toControlRunRelationEventData } from "./run-relations";
import type { ControlRunRelation } from "./run-relations";
import { createId, toJson, type AgentIdentity, type Env, type ExecutionMode } from "./types";

export type PackWorkflowRun = {
  runId: string;
  workflowIntentId: string;
  relation: ControlRunRelation;
};

type PackWorkflowArtifact = {
  id: string;
  kind: string;
  uri: string;
  title: string;
  mimeType: string;
  sizeBytes: number;
  data: Record<string, unknown>;
};

type StartPackWorkflowInput = {
  workflowType: string;
  policyReference: string;
  displayName: string;
  packId: string;
  toolInput: Record<string, unknown>;
  executionMode: ExecutionMode;
  stage?: string;
  engine?: string;
  source?: string;
  intentCreatedSummary?: string;
};

type RecordToolCallInput = PackWorkflowRun & {
  toolName: string;
  status: "completed" | "failed";
  inputSummary: string;
  outputSummary: string;
  data: Record<string, unknown>;
};

type FinishPackWorkflowInput = PackWorkflowRun & {
  workflowType: string;
  ok: boolean;
  summary: string;
  artifact?: PackWorkflowArtifact;
  artifactCreatedSummary?: string;
  data: Record<string, unknown>;
};

const packWorkflowToolCallId = (runId: string, toolName: string) =>
  `${runId}-tool-${toolName.replaceAll(".", "-")}`;

export const startPackWorkflowRun = async (
  env: Env,
  identity: AgentIdentity,
  input: StartPackWorkflowInput,
): Promise<PackWorkflowRun> => {
  const timestamp = new Date().toISOString();
  const workflowIntentId = createId("cf-intent");
  const runId = createId("cf-run");
  const builtRelation = buildControlRunRelation({ runId });
  if (!builtRelation.ok) throw new Error(builtRelation.reason);

  const relation = builtRelation.relation;
  const relationData = toControlRunRelationEventData(relation);
  const stage = input.stage ?? "analyze";
  const engine = input.engine ?? "langgraph-declared";
  const source = input.source ?? "agent-pack";
  const summary = input.intentCreatedSummary ?? `Created ${input.displayName} workflow intent.`;
  const execution = { mode: input.executionMode, policy: input.policyReference };

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
      stage,
      input.workflowType,
      toJson(execution),
      toJson({ input: input.toolInput }),
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
      "running",
      toJson(execution),
      stage,
      engine,
      timestamp,
      timestamp,
      toJson({
        displayName: input.displayName,
        workflowType: input.workflowType,
        source,
        packId: input.packId,
        relation,
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
    summary,
    targetType: "workflowIntent",
    targetId: workflowIntentId,
    data: { relation: relationData },
  });
  await appendControlPlaneEvent(env, identity, {
    type: "workflow.intent.created",
    summary,
    targetType: "workflowIntent",
    targetId: workflowIntentId,
    data: { runId, workflowIntentId, workflowType: input.workflowType, relation: relationData },
  });

  return { runId, workflowIntentId, relation };
};

export const recordPackWorkflowToolCall = async (
  env: Env,
  identity: AgentIdentity,
  input: RecordToolCallInput,
) => {
  const timestamp = new Date().toISOString();
  const id = packWorkflowToolCallId(input.runId, input.toolName);
  await env.DB.prepare(
    `INSERT INTO control_tool_calls (
       id, user_id, workspace_id, agent_id, workflow_intent_id, run_id, tool_id, status,
       input_summary, output_summary, artifact_refs_json, data_json, started_at, finished_at,
       created_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.agentId,
      input.workflowIntentId,
      input.runId,
      input.toolName,
      input.status,
      input.inputSummary,
      input.outputSummary,
      "[]",
      toJson(input.data),
      timestamp,
      timestamp,
      timestamp,
    )
    .run();
  return id;
};

export const finishPackWorkflowRun = async (
  env: Env,
  identity: AgentIdentity,
  input: FinishPackWorkflowInput,
) => {
  const timestamp = new Date().toISOString();
  const artifactRef = input.artifact
    ? {
        id: input.artifact.id,
        kind: input.artifact.kind,
        uri: input.artifact.uri,
        title: input.artifact.title,
        mimeType: input.artifact.mimeType,
      }
    : null;

  if (input.artifact) {
    await env.DB.prepare(
      `INSERT INTO control_artifacts (
         id, user_id, workspace_id, kind, uri, title, mime_type, size_bytes, data_json, created_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        input.artifact.id,
        identity.scope.userId,
        identity.scope.workspaceId,
        input.artifact.kind,
        input.artifact.uri,
        input.artifact.title,
        input.artifact.mimeType,
        input.artifact.sizeBytes,
        toJson(input.artifact.data),
        timestamp,
      )
      .run();

    await env.DB.prepare(
      `UPDATE control_tool_calls
       SET artifact_refs_json = ?
       WHERE user_id = ? AND workspace_id = ? AND run_id = ?`,
    )
      .bind(toJson([artifactRef]), identity.scope.userId, identity.scope.workspaceId, input.runId)
      .run();
  }

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE control_runs
       SET status = ?, last_event_at = ?, completed_at = ?, failed_at = ?, data_json = ?,
           updated_at = ?
       WHERE user_id = ? AND workspace_id = ? AND id = ?`,
    ).bind(
      input.ok ? "completed" : "failed",
      timestamp,
      input.ok ? timestamp : null,
      input.ok ? null : timestamp,
      toJson({
        summary: input.summary,
        ...input.data,
        artifactIds: artifactRef ? [artifactRef.id] : [],
      }),
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
      input.ok ? "completed" : "failed",
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
    action: input.ok ? "run.completed" : "run.failed",
    summary: input.summary,
    targetType: "run",
    targetId: input.runId,
    data: input.data,
  });
  if (artifactRef) {
    await appendControlAudit(env, {
      ...identity,
      runId: input.runId,
      workflowIntentId: input.workflowIntentId,
      action: "artifact.created",
      summary: input.artifactCreatedSummary ?? "Created workflow artifact.",
      targetType: "artifact",
      targetId: artifactRef.id,
    });
  }
  await appendControlPlaneEvent(env, identity, {
    type: input.ok ? "workflow.run.completed" : "workflow.run.failed",
    summary: input.summary,
    targetType: "run",
    targetId: input.runId,
    data: {
      runId: input.runId,
      workflowIntentId: input.workflowIntentId,
      workflowType: input.workflowType,
      artifactId: artifactRef?.id,
    },
  });
};
