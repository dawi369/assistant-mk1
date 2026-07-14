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

const retryableWorkflowTypes = new Set([
  "polymancer.market_research",
  "swordfish.runtime_research",
]);

const toRunHistoryItem = (
  row: ControlRunRow & {
    tool_call_count?: number;
    workflow_type?: string | null;
    pending_approval_count?: number;
  },
) => {
  const data = parseDataJson(row.data_json);
  const canCancel = row.status === "queued" || row.status === "running" || row.status === "waiting";
  const canRetry =
    (row.status === "failed" || row.status === "cancelled") &&
    Boolean(row.workflow_type && retryableWorkflowTypes.has(row.workflow_type));
  const canResume = row.status === "interrupted" && Boolean(row.pending_approval_count);
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
    workflowType: row.workflow_type ?? undefined,
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
    cancelledAt: row.cancelled_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    controls: {
      canCancel,
      canRetry,
      canResume,
      resumeKind: canResume ? "approval" : undefined,
    },
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
  storageProvider: row.storage_provider,
  contentSha256: row.content_sha256 ?? undefined,
  retentionClass: row.retention_class,
  expiresAt: row.expires_at ?? undefined,
  deletedAt: row.deleted_at ?? undefined,
  data: parseDataJson(row.data_json),
  createdAt: row.created_at,
});

export const listExecutionHistory = async (env: Env, identity: AgentIdentity, url: URL) => {
  const limit = readHistoryLimit(url);
  const rows = await env.DB.prepare(
    `SELECT
       r.id, r.user_id, r.workspace_id, r.agent_id, r.workflow_intent_id, r.status,
       r.execution_json, r.stage, r.engine, r.heartbeat_at, r.last_event_at,
       r.completed_at, r.failed_at, r.cancelled_at, r.data_json, r.created_at, r.updated_at,
       i.type AS workflow_type,
       COUNT(DISTINCT tc.id) AS tool_call_count,
       COUNT(DISTINCT CASE WHEN ar.status = 'requested' THEN ar.id END) AS pending_approval_count
     FROM control_runs r
     LEFT JOIN control_workflow_intents i
       ON i.user_id = r.user_id
      AND i.workspace_id = r.workspace_id
      AND i.id = r.workflow_intent_id
     LEFT JOIN control_tool_calls tc
       ON tc.user_id = r.user_id
      AND tc.workspace_id = r.workspace_id
      AND tc.run_id = r.id
     LEFT JOIN control_approval_requests ar
       ON ar.user_id = r.user_id
      AND ar.workspace_id = r.workspace_id
      AND ar.run_id = r.id
     WHERE r.user_id = ? AND r.workspace_id = ?
     GROUP BY r.id
     ORDER BY r.updated_at DESC, r.created_at DESC
     LIMIT ?`,
  )
    .bind(identity.scope.userId, identity.scope.workspaceId, limit)
    .all<
      ControlRunRow & {
        tool_call_count?: number;
        workflow_type?: string | null;
        pending_approval_count?: number;
      }
    >();

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
    `SELECT id, user_id, workspace_id, kind, uri, title, mime_type, size_bytes,
            storage_provider, storage_key, content_sha256, retention_class, expires_at, deleted_at,
            data_json, created_at
     FROM control_artifacts
     WHERE user_id = ? AND workspace_id = ? AND deleted_at IS NULL
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
