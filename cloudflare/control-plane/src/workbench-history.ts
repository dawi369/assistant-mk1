import { getControlRunSnapshot } from "./demo-run-store";
import { json, parseDataJson } from "./http";
import {
  type AgentIdentity,
  type ControlArtifactRow,
  type ControlRunRow,
  type Env,
  type TenantScope,
} from "./types";

const defaultHistoryLimit = 25;
const maxHistoryLimit = 100;

export const readHistoryLimit = (url: URL) => {
  const requested = Number(url.searchParams.get("limit") ?? defaultHistoryLimit);
  if (!Number.isFinite(requested)) return defaultHistoryLimit;
  return Math.min(Math.max(Math.trunc(requested), 1), maxHistoryLimit);
};

const scopeFromRow = (row: { user_id: string; workspace_id: string }): TenantScope => ({
  userId: row.user_id,
  workspaceId: row.workspace_id,
});

const toRunHistoryItem = (row: ControlRunRow & { tool_call_count?: number }) => {
  const data = parseDataJson(row.data_json);
  return {
    id: row.id,
    scope: scopeFromRow(row),
    agentId: row.agent_id,
    workflowIntentId: row.workflow_intent_id,
    status: row.status,
    stage: row.stage ?? undefined,
    engine: row.engine ?? undefined,
    summary: typeof data.summary === "string" ? data.summary : undefined,
    displayName: typeof data.displayName === "string" ? data.displayName : undefined,
    artifactIds: Array.isArray(data.artifactIds)
      ? data.artifactIds.filter((item): item is string => typeof item === "string")
      : [],
    decisionIds: Array.isArray(data.decisionIds)
      ? data.decisionIds.filter((item): item is string => typeof item === "string")
      : [],
    toolCallCount:
      typeof row.tool_call_count === "number" && Number.isFinite(row.tool_call_count)
        ? row.tool_call_count
        : 0,
    heartbeatAt: row.heartbeat_at ?? undefined,
    lastEventAt: row.last_event_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    failedAt: row.failed_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const toArtifactHistoryItem = (row: ControlArtifactRow) => ({
  id: row.id,
  scope: scopeFromRow(row),
  kind: row.kind,
  uri: row.uri,
  title: row.title ?? undefined,
  mimeType: row.mime_type ?? undefined,
  sizeBytes: row.size_bytes ?? undefined,
  data: parseDataJson(row.data_json),
  createdAt: row.created_at,
});

export const listExecutionHistory = async (env: Env, identity: AgentIdentity, url: URL) => {
  const limit = readHistoryLimit(url);
  const rows = await env.DB.prepare(
    `SELECT
       r.id, r.user_id, r.workspace_id, r.agent_id, r.workflow_intent_id, r.status,
       r.execution_json, r.stage, r.engine, r.heartbeat_at, r.last_event_at,
       r.completed_at, r.failed_at, r.data_json, r.created_at, r.updated_at,
       COUNT(tc.id) AS tool_call_count
     FROM control_runs r
     LEFT JOIN control_tool_calls tc
       ON tc.user_id = r.user_id
      AND tc.workspace_id = r.workspace_id
      AND tc.run_id = r.id
     WHERE r.user_id = ? AND r.workspace_id = ?
     GROUP BY r.id
     ORDER BY r.updated_at DESC, r.created_at DESC
     LIMIT ?`,
  )
    .bind(identity.scope.userId, identity.scope.workspaceId, limit)
    .all<ControlRunRow & { tool_call_count?: number }>();

  return json({
    ok: true,
    runs: rows.results.map(toRunHistoryItem),
    limit,
  });
};

export const getExecutionHistoryRun = async (env: Env, identity: AgentIdentity, runId: string) => {
  const snapshot = await getControlRunSnapshot(env, identity.scope, runId);
  if (!snapshot) return json({ ok: false, error: "Run not found" }, { status: 404 });
  return json({ ok: true, snapshot });
};

export const listArtifactHistory = async (env: Env, identity: AgentIdentity, url: URL) => {
  const limit = readHistoryLimit(url);
  const rows = await env.DB.prepare(
    `SELECT id, user_id, workspace_id, kind, uri, title, mime_type, size_bytes, data_json, created_at
     FROM control_artifacts
     WHERE user_id = ? AND workspace_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
  )
    .bind(identity.scope.userId, identity.scope.workspaceId, limit)
    .all<ControlArtifactRow>();

  return json({
    ok: true,
    artifacts: rows.results.map(toArtifactHistoryItem),
    limit,
  });
};
