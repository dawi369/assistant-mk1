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
  engine: "cloudflare" | "langgraph";
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
  const engine = input.engine;
  const source = input.source ?? "agent-pack";
  const summary = input.intentCreatedSummary ?? `Created ${input.displayName} workflow intent.`;
  const execution = { mode: input.executionMode, policy: input.policyReference };

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO control_workflow_intents (
       id, user_id, workspace_id, agent_id, stage, type, execution_json, payload_json,
       status, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
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
    ),
    env.DB.prepare(
      `INSERT INTO control_runs (
       id, user_id, workspace_id, agent_id, workflow_intent_id, status, execution_json,
       stage, engine, heartbeat_at, last_event_at, data_json, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
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
    ),
    env.DB.prepare(
      `INSERT INTO control_audit_events (
         id, user_id, workspace_id, action, summary, target_type, target_id, data_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      createId("cf-audit"),
      identity.scope.userId,
      identity.scope.workspaceId,
      "intent.created",
      summary,
      "workflowIntent",
      workflowIntentId,
      toJson({
        eventName: "intent.created",
        runId,
        workflowIntentId,
        relation: relationData,
      }),
      timestamp,
    ),
    env.DB.prepare(
      `INSERT INTO control_plane_events (
         id, user_id, workspace_id, agent_id, type, summary, target_type, target_id,
         data_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      createId("cf-event"),
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.agentId,
      "workflow.intent.created",
      summary,
      "workflowIntent",
      workflowIntentId,
      toJson({ runId, workflowIntentId, workflowType: input.workflowType, relation: relationData }),
      timestamp,
    ),
  ]);

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
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
     WHERE EXISTS (
       SELECT 1 FROM control_runs
       WHERE user_id = ? AND workspace_id = ? AND id = ?
         AND status IN ('queued', 'running', 'waiting', 'interrupted')
     )`,
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
      identity.scope.userId,
      identity.scope.workspaceId,
      input.runId,
    )
    .run();
  return id;
};

export const finishPackWorkflowRun = async (
  env: Env,
  identity: AgentIdentity,
  input: FinishPackWorkflowInput,
): Promise<{ applied: boolean }> => {
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

  const statements = [];
  if (input.artifact) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO control_artifacts (
         id, user_id, workspace_id, kind, uri, title, mime_type, size_bytes, data_json, created_at
       )
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM control_runs
         WHERE user_id = ? AND workspace_id = ? AND id = ?
           AND status IN ('queued', 'running', 'waiting', 'interrupted')
       )`,
      ).bind(
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
        identity.scope.userId,
        identity.scope.workspaceId,
        input.runId,
      ),
      env.DB.prepare(
        `UPDATE control_tool_calls
       SET artifact_refs_json = ?
       WHERE user_id = ? AND workspace_id = ? AND run_id = ?
         AND EXISTS (
           SELECT 1 FROM control_runs
           WHERE user_id = ? AND workspace_id = ? AND id = ?
             AND status IN ('queued', 'running', 'waiting', 'interrupted')
         )`,
      ).bind(
        toJson([artifactRef]),
        identity.scope.userId,
        identity.scope.workspaceId,
        input.runId,
        identity.scope.userId,
        identity.scope.workspaceId,
        input.runId,
      ),
    );
  }

  statements.push(
    env.DB.prepare(
      `UPDATE control_workflow_intents
       SET status = ?, updated_at = ?
       WHERE user_id = ? AND workspace_id = ? AND id = ?
         AND EXISTS (
           SELECT 1 FROM control_runs
           WHERE user_id = ? AND workspace_id = ? AND id = ?
             AND status IN ('queued', 'running', 'waiting', 'interrupted')
         )`,
    ).bind(
      input.ok ? "completed" : "failed",
      timestamp,
      identity.scope.userId,
      identity.scope.workspaceId,
      input.workflowIntentId,
      identity.scope.userId,
      identity.scope.workspaceId,
      input.runId,
    ),
    env.DB.prepare(
      `UPDATE control_runs
       SET status = ?, last_event_at = ?, completed_at = ?, failed_at = ?, data_json = ?,
           updated_at = ?
       WHERE user_id = ? AND workspace_id = ? AND id = ?
         AND status IN ('queued', 'running', 'waiting', 'interrupted')`,
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
  );
  const runResultIndex = statements.length - 1;
  const terminalStatus = input.ok ? "completed" : "failed";
  statements.push(
    env.DB.prepare(
      `INSERT INTO control_audit_events (
         id, user_id, workspace_id, action, summary, target_type, target_id, data_json, created_at
       ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM control_runs
         WHERE user_id = ? AND workspace_id = ? AND id = ? AND status = ? AND updated_at = ?
       )`,
    ).bind(
      createId("cf-audit"),
      identity.scope.userId,
      identity.scope.workspaceId,
      input.ok ? "run.completed" : "run.failed",
      input.summary,
      "run",
      input.runId,
      toJson({
        eventName: input.ok ? "run.completed" : "run.failed",
        runId: input.runId,
        workflowIntentId: input.workflowIntentId,
        ...input.data,
      }),
      timestamp,
      identity.scope.userId,
      identity.scope.workspaceId,
      input.runId,
      terminalStatus,
      timestamp,
    ),
    env.DB.prepare(
      `INSERT INTO control_plane_events (
         id, user_id, workspace_id, agent_id, type, summary, target_type, target_id,
         data_json, created_at
       ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM control_runs
         WHERE user_id = ? AND workspace_id = ? AND id = ? AND status = ? AND updated_at = ?
       )`,
    ).bind(
      createId("cf-event"),
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.agentId,
      input.ok ? "workflow.run.completed" : "workflow.run.failed",
      input.summary,
      "run",
      input.runId,
      toJson({
        runId: input.runId,
        workflowIntentId: input.workflowIntentId,
        workflowType: input.workflowType,
        artifactId: artifactRef?.id,
      }),
      timestamp,
      identity.scope.userId,
      identity.scope.workspaceId,
      input.runId,
      terminalStatus,
      timestamp,
    ),
  );
  if (artifactRef) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO control_audit_events (
           id, user_id, workspace_id, action, summary, target_type, target_id, data_json, created_at
         ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM control_runs
           WHERE user_id = ? AND workspace_id = ? AND id = ? AND status = ? AND updated_at = ?
         )`,
      ).bind(
        createId("cf-audit"),
        identity.scope.userId,
        identity.scope.workspaceId,
        "artifact.created",
        input.artifactCreatedSummary ?? "Created workflow artifact.",
        "artifact",
        artifactRef.id,
        toJson({
          eventName: "artifact.created",
          runId: input.runId,
          workflowIntentId: input.workflowIntentId,
        }),
        timestamp,
        identity.scope.userId,
        identity.scope.workspaceId,
        input.runId,
        terminalStatus,
        timestamp,
      ),
    );
  }
  const results = await env.DB.batch(statements);
  if (results[runResultIndex]?.meta?.changes === 0) return { applied: false };
  return { applied: true };
};
