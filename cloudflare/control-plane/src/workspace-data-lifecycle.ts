import { selectMembership, selectWorkspace } from "./authz-store";
import { resolveThreadAgentInstanceName } from "./chat-agent-connection-context";
import { revokeWorkspaceConnections } from "./connection-broker";
import { retainedDataEnabled } from "./feature-gates";
import { isRecord, json, parseDataJson } from "./http";
import { requireAdminMembership } from "./membership-policy";
import { prepareOperatorAlertStatement } from "./operator-alerts";
import { createStoredZip, textZipEntry } from "./zip-archive";
import {
  createId,
  toJson,
  type AgentIdentity,
  type ChatThreadRow,
  type ControlArtifactRow,
  type ControlDataJobRow,
  type D1PreparedStatement,
  type Env,
} from "./types";

const exportExpiryMs = 7 * 24 * 60 * 60 * 1_000;
const deletionRecoveryMs = 30 * 24 * 60 * 60 * 1_000;
const reauthenticationMaxAgeMs = 5 * 60 * 1_000;
const maximumExportBytes = 110 * 1024 * 1024;
const collectionPageSize = 500;
const maximumCollectionRows = 50_000;
const exportFenceLeaseMs = 10 * 60 * 1_000;
const exportSnapshotBatchSize = 50;

type ExportCollection = {
  name: string;
  query: string;
  keyExpression: string;
  bindings: (identity: AgentIdentity) => unknown[];
};

const tenantCollection = (name: string, select = "*", keyExpression = "id"): ExportCollection => ({
  name,
  query: `SELECT ${select} FROM ${name} WHERE workspace_id = ?`,
  keyExpression,
  bindings: (identity) => [identity.scope.workspaceId],
});

const exportCollections: readonly ExportCollection[] = [
  {
    name: "users",
    query:
      "SELECT * FROM users WHERE id IN (SELECT user_id FROM memberships WHERE workspace_id = ?)",
    keyExpression: "id",
    bindings: (identity) => [identity.scope.workspaceId],
  },
  {
    name: "workspaces",
    query: "SELECT * FROM workspaces WHERE id = ?",
    keyExpression: "id",
    bindings: (identity) => [identity.scope.workspaceId],
  },
  tenantCollection("active_workspace_preferences", "*", "user_id || ':' || account_id"),
  tenantCollection("memberships"),
  {
    name: "agents",
    query: "SELECT * FROM agents WHERE workspace_id = ?",
    keyExpression: "id",
    bindings: (identity) => [identity.scope.workspaceId],
  },
  tenantCollection("active_agent_preferences", "*", "user_id || ':' || workspace_id"),
  tenantCollection("tool_permissions"),
  tenantCollection("control_policy_decisions"),
  tenantCollection("control_workflow_intents"),
  tenantCollection("control_runs"),
  tenantCollection("control_approval_requests"),
  tenantCollection("control_tool_calls"),
  tenantCollection("control_artifacts"),
  tenantCollection("control_decisions"),
  tenantCollection("control_managed_state"),
  tenantCollection(
    "control_triggers",
    `id, user_id, workspace_id, agent_id, pack_id, pack_trigger_id, kind, workflow_type,
     status, execution_json, config_json, input_json, max_concurrent_runs, version,
     next_trigger_at, last_triggered_at, created_by_user_id, created_at, updated_at, public_id`,
  ),
  tenantCollection("control_trigger_dispatches"),
  tenantCollection("control_audit_events"),
  tenantCollection("control_operator_alerts"),
  tenantCollection("control_retention_policies", "*", "user_id || ':' || workspace_id"),
  tenantCollection("control_plane_events"),
  tenantCollection("runtime_traces", "*", "trace_id"),
  tenantCollection("runtime_spans", "*", "span_id"),
  tenantCollection("chat_sessions", "*", "session_id"),
  tenantCollection("chat_threads", "*", "thread_id"),
  tenantCollection("chat_intents"),
  tenantCollection("chat_policy_decisions"),
  tenantCollection("chat_runs"),
  tenantCollection(
    "control_connections",
    `id, user_id, workspace_id, agent_id, pack_id, connection_id, provider_id, principal,
     credential_class, status, scopes_json, token_expires_at, last_used_at, last_health_at,
     last_error_code, version, data_json, created_at, updated_at, revoked_at`,
  ),
  tenantCollection("control_action_proposals"),
  tenantCollection("control_action_ledger"),
  tenantCollection("control_kill_switches"),
];

export const workspaceExportOmittedTables = [
  "control_data_jobs",
  "control_workspace_write_fences",
  "control_connection_oauth_states",
  "control_connection_capabilities",
] as const;

const requireLifecycleAdmin = async (env: Env, identity: AgentIdentity) => {
  const membership = await selectMembership(env, identity.scope.userId, identity.scope.workspaceId);
  return requireAdminMembership(membership);
};

const requireLifecycleOwner = async (env: Env, identity: AgentIdentity) => {
  const membership = await selectMembership(env, identity.scope.userId, identity.scope.workspaceId);
  return membership?.status === "active" && membership.role === "owner"
    ? null
    : json({ ok: false, error: "Workspace owner membership is required." }, { status: 403 });
};

const bytesToHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const sha256Hex = async (bytes: Uint8Array) =>
  bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer)));

const loadCollection = async (env: Env, identity: AgentIdentity, collection: ExportCollection) => {
  const rows: Record<string, unknown>[] = [];
  let cursor = "";
  while (rows.length < maximumCollectionRows) {
    const page = await env.DB.prepare(
      `SELECT export_rows.*, CAST(${collection.keyExpression} AS TEXT) AS __export_key
       FROM (${collection.query}) export_rows
       WHERE CAST(${collection.keyExpression} AS TEXT) > ?
       ORDER BY CAST(${collection.keyExpression} AS TEXT) ASC
       LIMIT ?`,
    )
      .bind(...collection.bindings(identity), cursor, collectionPageSize)
      .all<Record<string, unknown> & { __export_key: string }>();
    for (const row of page.results) {
      const { __export_key: key, ...payload } = row;
      cursor = key;
      rows.push(payload);
    }
    if (page.results.length < collectionPageSize) return rows;
  }
  throw new Error(`collection_too_large:${collection.name}`);
};

const loadCollections = async (env: Env, identity: AgentIdentity) => {
  const collections: Record<string, Record<string, unknown>[]> = {};
  for (const collection of exportCollections) {
    collections[collection.name] = await loadCollection(env, identity, collection);
  }
  return collections;
};

const jobSummary = (row: ControlDataJobRow) => ({
  id: row.id,
  kind: row.kind,
  status: row.status,
  attemptCount: row.attempt_count,
  manualRetryCount: row.manual_retry_count,
  lastErrorCode: row.last_error_code ?? undefined,
  lastFailedAt: row.last_failed_at ?? undefined,
  sizeBytes: row.size_bytes ?? undefined,
  contentSha256: row.content_sha256 ?? undefined,
  expiresAt: row.expires_at ?? undefined,
  error: parseDataJson(row.error_json),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  completedAt: row.completed_at ?? undefined,
});

const selectJob = (env: Env, identity: AgentIdentity, jobId: string) =>
  env.DB.prepare(
    `SELECT id, user_id, workspace_id, kind, status, cursor_json, result_json, error_json,
            storage_key, content_sha256, size_bytes, attempt_count, last_error_code,
            last_failed_at, manual_retry_count, lease_owner,
            lease_expires_at, expires_at, created_by_user_id, created_at, updated_at, completed_at
     FROM control_data_jobs WHERE id = ? AND user_id = ? AND workspace_id = ? LIMIT 1`,
  )
    .bind(jobId, identity.scope.userId, identity.scope.workspaceId)
    .first<ControlDataJobRow>();

const threadLifecycleRequest = async (
  env: Env,
  thread: ChatThreadRow,
  action: "export" | "purge" | "freeze" | "unfreeze",
  jobId?: string,
) => {
  if (!env.WorkbenchThreadChatAgent || !env.WORKBENCH_AGENT_CONNECTION_SECRET) {
    throw new Error("durable_object_lifecycle_unavailable");
  }
  const name = await resolveThreadAgentInstanceName(thread);
  const stub = env.WorkbenchThreadChatAgent.get(env.WorkbenchThreadChatAgent.idFromName(name));
  const response = await stub.fetch(`https://thread-agent.internal/internal/lifecycle-${action}`, {
    method: "POST",
    headers: { "x-workbench-lifecycle-secret": env.WORKBENCH_AGENT_CONNECTION_SECRET },
    body:
      action === "freeze" || action === "unfreeze"
        ? JSON.stringify({ jobId: jobId ?? "" })
        : undefined,
  });
  if (!response.ok) throw new Error(`durable_object_${action}_failed`);
  return action === "export" || action === "freeze"
    ? ((await response.json()) as {
        messages?: unknown[];
        snapshotAt?: string;
        messageCount?: number;
        contentSha256?: string;
      })
    : null;
};

const exportStorageKey = (identity: AgentIdentity, jobId: string) =>
  [
    "tenants",
    encodeURIComponent(identity.scope.userId),
    encodeURIComponent(identity.scope.workspaceId),
    "exports",
    `${encodeURIComponent(jobId)}.zip`,
  ].join("/");

type ExportSnapshotCursor = {
  phase?:
    | "awaiting_quiescence"
    | "fenced"
    | "do_frozen"
    | "d1_materialized"
    | "r2_pinned"
    | "released"
    | "assembling";
  snapshotAt?: string;
  fenceAcquiredAt?: string;
  fenceReleasedAt?: string;
  fenceDurationMs?: number;
  collectionCounts?: Record<string, number>;
  durableObjectThreadCount?: number;
  durableObjectChecksums?: Record<string, string>;
  e2eFailPhase?: "after_d1_materialized" | "after_r2_pinned" | "assembling";
  e2eFailuresRemaining?: number;
};

const readExportSnapshotCursor = (job: ControlDataJobRow): ExportSnapshotCursor =>
  parseDataJson(job.cursor_json) as ExportSnapshotCursor;

const updateExportSnapshotCursor = async (
  env: Env,
  job: ControlDataJobRow,
  cursor: ExportSnapshotCursor,
) => {
  const timestamp = new Date().toISOString();
  const result = await env.DB.prepare(
    `UPDATE control_data_jobs SET cursor_json = ?, updated_at = ?
     WHERE id = ? AND user_id = ? AND workspace_id = ? AND status = 'running'`,
  )
    .bind(toJson(cursor), timestamp, job.id, job.user_id, job.workspace_id)
    .run();
  if (((result as { meta?: { changes?: number } }).meta?.changes ?? 0) === 0) {
    throw new Error("data_job_publication_revoked");
  }
  return cursor;
};

const batchStatements = async (env: Env, statements: D1PreparedStatement[]) => {
  for (let offset = 0; offset < statements.length; offset += exportSnapshotBatchSize) {
    await env.DB.batch(statements.slice(offset, offset + exportSnapshotBatchSize));
  }
};

const renewExportFence = async (env: Env, job: ControlDataJobRow) => {
  const timestamp = new Date().toISOString();
  const leaseExpiresAt = new Date(Date.now() + exportFenceLeaseMs).toISOString();
  const renewed = await env.DB.prepare(
    `UPDATE control_workspace_write_fences
     SET lease_expires_at = ?, version = version + 1, updated_at = ?
     WHERE workspace_id = ? AND job_id = ? AND status = 'active'`,
  )
    .bind(leaseExpiresAt, timestamp, job.workspace_id, job.id)
    .run();
  if (((renewed as { meta?: { changes?: number } }).meta?.changes ?? 0) === 0) {
    throw new Error("workspace_export_fence_lost");
  }
};

const acquireExportFence = async (env: Env, job: ControlDataJobRow) => {
  const timestamp = new Date().toISOString();
  const leaseExpiresAt = new Date(Date.now() + exportFenceLeaseMs).toISOString();
  await env.DB.prepare(
    `INSERT INTO control_workspace_write_fences (
       workspace_id, job_id, status, lease_owner, lease_expires_at, version, acquired_at, updated_at
     ) VALUES (?, ?, 'active', ?, ?, 1, ?, ?)
     ON CONFLICT(workspace_id) DO UPDATE SET
       job_id = excluded.job_id,
       status = 'active',
       lease_owner = excluded.lease_owner,
       lease_expires_at = excluded.lease_expires_at,
       version = control_workspace_write_fences.version + 1,
       acquired_at = CASE
         WHEN control_workspace_write_fences.job_id = excluded.job_id
           THEN control_workspace_write_fences.acquired_at
         ELSE excluded.acquired_at
       END,
       updated_at = excluded.updated_at
     WHERE control_workspace_write_fences.job_id = excluded.job_id
       OR control_workspace_write_fences.lease_expires_at <= excluded.acquired_at`,
  )
    .bind(
      job.workspace_id,
      job.id,
      job.lease_owner ?? `export:${job.id}`,
      leaseExpiresAt,
      timestamp,
      timestamp,
    )
    .run();
  const owned = await env.DB.prepare(
    `SELECT job_id FROM control_workspace_write_fences
     WHERE workspace_id = ? AND job_id = ? AND status = 'active' AND lease_expires_at > ?`,
  )
    .bind(job.workspace_id, job.id, timestamp)
    .first<{ job_id: string }>();
  if (!owned) throw new Error("workspace_export_fence_conflict");
};

const listWorkspaceThreads = (env: Env, workspaceId: string) =>
  env.DB.prepare(
    `SELECT thread_id, session_id, user_id, workspace_id, agent_id, status, upstream_json,
            created_at, updated_at, last_seen_at
     FROM chat_threads WHERE workspace_id = ? ORDER BY thread_id ASC`,
  )
    .bind(workspaceId)
    .all<ChatThreadRow>();

const releaseExportFence = async (env: Env, job: ControlDataJobRow) => {
  const owned = await env.DB.prepare(
    `SELECT job_id FROM control_workspace_write_fences
     WHERE workspace_id = ? AND job_id = ? LIMIT 1`,
  )
    .bind(job.workspace_id, job.id)
    .first<{ job_id: string }>();
  if (!owned) return;
  await env.DB.prepare(
    `UPDATE control_workspace_write_fences SET status = 'releasing', updated_at = ?
     WHERE workspace_id = ? AND job_id = ?`,
  )
    .bind(new Date().toISOString(), job.workspace_id, job.id)
    .run();
  const threads = await listWorkspaceThreads(env, job.workspace_id);
  const failures: string[] = [];
  for (const thread of threads.results) {
    try {
      await threadLifecycleRequest(env, thread, "unfreeze", job.id);
    } catch {
      failures.push(thread.thread_id);
    }
  }
  if (failures.length) {
    throw new Error("durable_object_unfreeze_incomplete");
  }
  await env.DB.prepare(
    `DELETE FROM control_workspace_write_fences WHERE workspace_id = ? AND job_id = ?`,
  )
    .bind(job.workspace_id, job.id)
    .run();
};

const recordExportFenceReleased = async (
  env: Env,
  job: ControlDataJobRow,
  cursor: ExportSnapshotCursor,
) => {
  const fenceReleasedAt = new Date().toISOString();
  const acquiredAt = Date.parse(cursor.fenceAcquiredAt ?? cursor.snapshotAt ?? fenceReleasedAt);
  return updateExportSnapshotCursor(env, job, {
    ...cursor,
    phase: "released",
    fenceReleasedAt,
    fenceDurationMs: Math.max(0, Date.parse(fenceReleasedAt) - acquiredAt),
  });
};

const clearExportSnapshot = (env: Env, jobId: string) =>
  env.DB.batch([
    env.DB.prepare("DELETE FROM control_data_export_rows WHERE job_id = ?").bind(jobId),
    env.DB.prepare("DELETE FROM control_data_export_objects WHERE job_id = ?").bind(jobId),
  ]);

const stageSnapshotRows = async (
  env: Env,
  job: ControlDataJobRow,
  collectionName: string,
  rows: Array<{ key: string; payload: Record<string, unknown> }>,
  timestamp: string,
) => {
  await batchStatements(
    env,
    rows.map((row) =>
      env.DB.prepare(
        `INSERT OR REPLACE INTO control_data_export_rows (
           job_id, collection_name, row_key, payload_json, created_at
         ) VALUES (?, ?, ?, ?, ?)`,
      ).bind(job.id, collectionName, row.key, toJson(row.payload), timestamp),
    ),
  );
};

const pauseE2eExportBoundary = async (env: Env) => {
  const configured = env.WORKBENCH_E2E_EXPORT_PAUSE_MS?.trim();
  if (!configured) return;
  if (env.WORKBENCH_E2E_MODE !== "true") {
    throw new Error("e2e_export_pause_requires_e2e_mode");
  }
  const delayMs = Number(configured);
  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 2_000) {
    throw new Error("e2e_export_pause_invalid");
  }
  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
};

const lifecycleFaultInjectionEnabled = (env: Env) =>
  env.WORKBENCH_E2E_MODE === "true" || env.WORKBENCH_CONFORMANCE_MODE === "true";

const injectE2eExportFailure = async (
  env: Env,
  job: ControlDataJobRow,
  cursor: ExportSnapshotCursor,
  phase: NonNullable<ExportSnapshotCursor["e2eFailPhase"]>,
) => {
  if (
    !lifecycleFaultInjectionEnabled(env) ||
    cursor.e2eFailPhase !== phase ||
    (cursor.e2eFailuresRemaining ?? 0) <= 0
  ) {
    return cursor;
  }
  const next = await updateExportSnapshotCursor(env, job, {
    ...cursor,
    e2eFailuresRemaining: (cursor.e2eFailuresRemaining ?? 0) - 1,
  });
  throw Object.assign(new Error(`e2e_export_${phase}_failure`), { cursor: next });
};

const loadStagedArtifacts = async (env: Env, jobId: string) => {
  const rows = await env.DB.prepare(
    `SELECT payload_json FROM control_data_export_rows
     WHERE job_id = ? AND collection_name = 'control_artifacts'
     ORDER BY row_key ASC`,
  )
    .bind(jobId)
    .all<{ payload_json: string }>();
  return rows.results.map(
    (row) => parseDataJson(row.payload_json) as unknown as ControlArtifactRow,
  );
};

const captureExportSnapshot = async (env: Env, identity: AgentIdentity, job: ControlDataJobRow) => {
  let cursor = readExportSnapshotCursor(job);
  const snapshotAt = cursor.snapshotAt ?? new Date().toISOString();
  try {
    if (
      !cursor.phase ||
      ["awaiting_quiescence", "fenced", "do_frozen", "d1_materialized"].includes(cursor.phase)
    ) {
      await acquireExportFence(env, job);
    }
    if (!cursor.phase || cursor.phase === "awaiting_quiescence") {
      await clearExportSnapshot(env, job.id);
      cursor = await updateExportSnapshotCursor(env, job, {
        ...cursor,
        phase: "fenced",
        snapshotAt,
        fenceAcquiredAt: new Date().toISOString(),
      });
      await pauseE2eExportBoundary(env);
    }

    if (cursor.phase === "fenced") {
      await env.DB.prepare(
        `DELETE FROM control_data_export_rows
         WHERE job_id = ? AND collection_name = 'durable_object_thread_messages'`,
      )
        .bind(job.id)
        .run();
      const threads = await listWorkspaceThreads(env, identity.scope.workspaceId);
      const threadRows: Array<{ key: string; payload: Record<string, unknown> }> = [];
      const durableObjectChecksums: Record<string, string> = {};
      for (const thread of threads.results) {
        const frozen = await threadLifecycleRequest(env, thread, "freeze", job.id);
        if (!frozen?.contentSha256 || frozen.messageCount !== (frozen.messages ?? []).length) {
          throw new Error("durable_object_snapshot_evidence_invalid");
        }
        durableObjectChecksums[thread.thread_id] = frozen.contentSha256;
        threadRows.push({
          key: thread.thread_id,
          payload: {
            threadId: thread.thread_id,
            snapshotAt: frozen.snapshotAt,
            messageCount: frozen.messageCount,
            contentSha256: frozen.contentSha256,
            messages: frozen.messages ?? [],
          },
        });
      }
      await stageSnapshotRows(env, job, "durable_object_thread_messages", threadRows, snapshotAt);
      cursor = await updateExportSnapshotCursor(env, job, {
        ...cursor,
        phase: "do_frozen",
        durableObjectThreadCount: threadRows.length,
        durableObjectChecksums,
      });
      await pauseE2eExportBoundary(env);
    }

    if (cursor.phase === "do_frozen") {
      await env.DB.prepare(
        `DELETE FROM control_data_export_rows
         WHERE job_id = ? AND collection_name <> 'durable_object_thread_messages'`,
      )
        .bind(job.id)
        .run();
      const collectionCounts: Record<string, number> = {};
      for (const collection of exportCollections) {
        let rowCursor = "";
        let count = 0;
        while (count < maximumCollectionRows) {
          const page = await env.DB.prepare(
            `SELECT export_rows.*, CAST(${collection.keyExpression} AS TEXT) AS __export_key
             FROM (${collection.query}) export_rows
             WHERE CAST(${collection.keyExpression} AS TEXT) > ?
             ORDER BY CAST(${collection.keyExpression} AS TEXT) ASC
             LIMIT ?`,
          )
            .bind(...collection.bindings(identity), rowCursor, collectionPageSize)
            .all<Record<string, unknown> & { __export_key: string }>();
          const staged = page.results.map((row) => {
            const { __export_key: key, ...payload } = row;
            return { key, payload };
          });
          await stageSnapshotRows(env, job, collection.name, staged, snapshotAt);
          count += staged.length;
          if (staged.length < collectionPageSize) break;
          rowCursor = staged.at(-1)?.key ?? rowCursor;
          await renewExportFence(env, job);
        }
        if (count >= maximumCollectionRows) {
          throw new Error(`collection_too_large:${collection.name}`);
        }
        collectionCounts[collection.name] = count;
        await renewExportFence(env, job);
      }
      cursor = await updateExportSnapshotCursor(env, job, {
        ...cursor,
        phase: "d1_materialized",
        collectionCounts,
      });
      await injectE2eExportFailure(env, job, cursor, "after_d1_materialized");
    }

    if (cursor.phase === "d1_materialized") {
      await env.DB.prepare("DELETE FROM control_data_export_objects WHERE job_id = ?")
        .bind(job.id)
        .run();
      const pinnedArtifacts = await loadStagedArtifacts(env, job.id);
      const objectStatements = pinnedArtifacts
        .filter(
          (artifact) =>
            artifact.storage_provider === "r2" &&
            artifact.storage_key &&
            artifact.content_sha256 &&
            !artifact.deleted_at,
        )
        .map((artifact) =>
          env.DB.prepare(
            `INSERT OR REPLACE INTO control_data_export_objects (
               job_id, artifact_id, storage_key, content_sha256, size_bytes, status, created_at
             ) VALUES (?, ?, ?, ?, ?, 'pinned', ?)`,
          ).bind(
            job.id,
            artifact.id,
            artifact.storage_key,
            artifact.content_sha256,
            artifact.size_bytes,
            snapshotAt,
          ),
        );
      await batchStatements(env, objectStatements);
      cursor = await updateExportSnapshotCursor(env, job, {
        ...cursor,
        phase: "r2_pinned",
      });
      await injectE2eExportFailure(env, job, cursor, "after_r2_pinned");
    }

    if (cursor.phase === "r2_pinned") {
      await releaseExportFence(env, job);
      cursor = await recordExportFenceReleased(env, job, cursor);
    }
    return cursor;
  } catch (error) {
    if (error instanceof Error && error.message === "data_job_publication_revoked") {
      await releaseExportFence(env, job).catch(() => undefined);
    }
    throw error;
  }
};

const loadStagedSnapshot = async (env: Env, jobId: string) => {
  const collections = new Map<string, string[]>();
  let collectionCursor = "";
  let rowCursor = "";
  while (true) {
    const page = await env.DB.prepare(
      `SELECT collection_name, row_key, payload_json FROM control_data_export_rows
       WHERE job_id = ? AND (
         collection_name > ? OR (collection_name = ? AND row_key > ?)
       )
       ORDER BY collection_name ASC, row_key ASC LIMIT ?`,
    )
      .bind(jobId, collectionCursor, collectionCursor, rowCursor, collectionPageSize)
      .all<{ collection_name: string; row_key: string; payload_json: string }>();
    for (const row of page.results) {
      const values = collections.get(row.collection_name) ?? [];
      values.push(row.payload_json);
      collections.set(row.collection_name, values);
      collectionCursor = row.collection_name;
      rowCursor = row.row_key;
    }
    if (page.results.length < collectionPageSize) break;
  }
  return collections;
};

const runExportJob = async (env: Env, identity: AgentIdentity, job: ControlDataJobRow) => {
  if (!env.ARTIFACTS) throw new Error("artifact_storage_unavailable");
  let cursor = readExportSnapshotCursor(job);
  if (cursor.phase !== "released" && cursor.phase !== "assembling") {
    await captureExportSnapshot(env, identity, job);
    const refreshed = await selectJob(env, identity, job.id);
    if (!refreshed) throw new Error("data_job_publication_revoked");
    cursor = readExportSnapshotCursor(refreshed);
  }
  if (cursor.phase === "released") {
    cursor = await updateExportSnapshotCursor(env, job, { ...cursor, phase: "assembling" });
  }
  await injectE2eExportFailure(env, job, cursor, "assembling");
  const refreshed = await selectJob(env, identity, job.id);
  if (!refreshed) throw new Error("data_job_publication_revoked");
  cursor = readExportSnapshotCursor(refreshed);
  if (cursor.phase !== "assembling" || !cursor.snapshotAt) {
    throw new Error("workspace_export_snapshot_incomplete");
  }

  const collections = await loadStagedSnapshot(env, job.id);
  const entries: Array<{ name: string; content: Uint8Array }> = [];
  for (const [name, rows] of collections) {
    if (name === "durable_object_thread_messages") continue;
    entries.push(textZipEntry(`d1/${name}.ndjson`, rows.join("\n")));
  }
  entries.push(
    textZipEntry(
      "durable-objects/thread-messages.ndjson",
      (collections.get("durable_object_thread_messages") ?? []).join("\n"),
    ),
  );

  const objects = await env.DB.prepare(
    `SELECT artifact_id, storage_key, content_sha256, size_bytes
     FROM control_data_export_objects WHERE job_id = ? ORDER BY artifact_id ASC`,
  )
    .bind(job.id)
    .all<{
      artifact_id: string;
      storage_key: string;
      content_sha256: string;
      size_bytes: number | null;
    }>();
  for (const pinned of objects.results) {
    const object = await env.ARTIFACTS.get(pinned.storage_key);
    if (!object) throw new Error(`artifact_content_missing:${pinned.artifact_id}`);
    const content = new Uint8Array(await object.arrayBuffer());
    if ((await sha256Hex(content)) !== pinned.content_sha256) {
      throw new Error(`artifact_checksum_mismatch:${pinned.artifact_id}`);
    }
    entries.push({ name: `artifacts/${encodeURIComponent(pinned.artifact_id)}`, content });
  }

  const fileEvidence = await Promise.all(
    entries.map(async (entry) => ({
      path: entry.name,
      sizeBytes: entry.content.byteLength,
      sha256: await sha256Hex(entry.content),
    })),
  );

  const generatedAt = new Date().toISOString();
  const manifest = {
    version: 3,
    generatedAt,
    snapshotId: job.id,
    snapshotAt: cursor.snapshotAt,
    fenceDurationMs: cursor.fenceDurationMs ?? 0,
    scope: identity.scope,
    collections: cursor.collectionCounts ?? {},
    durableObjectThreadCount: cursor.durableObjectThreadCount ?? 0,
    artifactCount: entries.filter((entry) => entry.name.startsWith("artifacts/")).length,
    files: fileEvidence,
    omittedTables: workspaceExportOmittedTables,
    excludedSecurityState: [
      "control_request_nonces",
      "control_triggers.secret_hash",
      "control_connection_oauth_states",
      "control_connection_capabilities",
      "control_connections.vault_object_id",
      "control_connections.vault_version",
      "WorkOS Vault credential objects",
    ],
  };
  entries.unshift(textZipEntry("manifest.json", JSON.stringify(manifest, null, 2)));
  const archive = createStoredZip(entries);
  if (archive.byteLength > maximumExportBytes) throw new Error("workspace_export_too_large");
  const digest = await sha256Hex(archive);
  const storageKey = exportStorageKey(identity, job.id);
  await env.ARTIFACTS.put(storageKey, archive, {
    httpMetadata: { contentType: "application/zip" },
    customMetadata: {
      jobId: job.id,
      workspaceId: identity.scope.workspaceId,
      contentSha256: digest,
    },
  });
  const completedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + exportExpiryMs).toISOString();
  const published = await env.DB.batch([
    env.DB.prepare(
      `UPDATE control_data_jobs SET status = 'completed', storage_key = ?, content_sha256 = ?,
         size_bytes = ?, result_json = ?, error_json = '{}', lease_owner = NULL,
         lease_expires_at = NULL, expires_at = ?, completed_at = ?, updated_at = ?
       WHERE id = ? AND user_id = ? AND workspace_id = ? AND status = 'running'`,
    ).bind(
      storageKey,
      digest,
      archive.byteLength,
      toJson({ manifest }),
      expiresAt,
      completedAt,
      completedAt,
      job.id,
      identity.scope.userId,
      identity.scope.workspaceId,
    ),
    env.DB.prepare(
      `INSERT INTO control_audit_events (
         id, user_id, workspace_id, action, summary, target_type, target_id, data_json, created_at
       ) SELECT ?, ?, ?, 'workspace.data.exported', 'Workspace data export completed.',
         'dataJob', ?, ?, ? WHERE EXISTS (
           SELECT 1 FROM control_data_jobs WHERE id = ? AND status = 'completed'
         )`,
    ).bind(
      createId("cf-audit"),
      identity.scope.userId,
      identity.scope.workspaceId,
      job.id,
      toJson({
        sizeBytes: archive.byteLength,
        contentSha256: digest,
        snapshotAt: cursor.snapshotAt,
      }),
      completedAt,
      job.id,
    ),
  ]);
  if ((published[0]?.meta?.changes ?? 0) === 0) {
    await env.ARTIFACTS.delete(storageKey).catch(() => undefined);
    throw new Error("data_job_publication_revoked");
  }
  await clearExportSnapshot(env, job.id);
};

const purgeWorkspace = async (env: Env, identity: AgentIdentity, job: ControlDataJobRow) => {
  const workspace = await selectWorkspace(env, identity.scope.workspaceId);
  if (
    !workspace ||
    !["quarantined", "purging"].includes(workspace.status) ||
    !workspace.purge_after ||
    workspace.purge_after > new Date().toISOString()
  ) {
    throw new Error("workspace_purge_not_due");
  }
  if (workspace.status === "quarantined") {
    const purgeStartedAt = new Date().toISOString();
    const transition = await env.DB.prepare(
      `UPDATE workspaces SET status = 'purging', updated_at = ?
       WHERE id = ? AND status = 'quarantined' AND updated_at = ?
         AND EXISTS (SELECT 1 FROM control_data_jobs WHERE id = ? AND status = 'running')`,
    )
      .bind(purgeStartedAt, identity.scope.workspaceId, workspace.updated_at, job.id)
      .run();
    if (((transition as { meta?: { changes?: number } }).meta?.changes ?? 0) === 0) {
      throw new Error("workspace_purge_transition_conflict");
    }
  }
  let purgeCursor = parseDataJson(job.cursor_json);
  let purgePhase = typeof purgeCursor.phase === "string" ? purgeCursor.phase : "started";
  const phaseOrder = [
    "started",
    "credentials_revoked",
    "durable_objects_purged",
    "objects_deleted",
  ];
  const phaseReached = (phase: string) =>
    phaseOrder.indexOf(purgePhase) >= phaseOrder.indexOf(phase);
  const checkpoint = async (phase: string) => {
    const timestamp = new Date().toISOString();
    const result = await env.DB.prepare(
      `UPDATE control_data_jobs SET cursor_json = ?, updated_at = ?
       WHERE id = ? AND status = 'running'`,
    )
      .bind(toJson({ ...purgeCursor, phase, phaseUpdatedAt: timestamp }), timestamp, job.id)
      .run();
    if (((result as { meta?: { changes?: number } }).meta?.changes ?? 0) === 0) {
      throw new Error("workspace_purge_authority_revoked");
    }
    purgePhase = phase;
    purgeCursor = { ...purgeCursor, phase, phaseUpdatedAt: timestamp };
  };
  const injectE2eFailure = async (phase: string) => {
    const configuredPhase =
      lifecycleFaultInjectionEnabled(env) && typeof purgeCursor.e2eFailPhase === "string"
        ? purgeCursor.e2eFailPhase
        : undefined;
    const remaining =
      typeof purgeCursor.e2eFailuresRemaining === "number" ? purgeCursor.e2eFailuresRemaining : 0;
    if (configuredPhase !== phase || remaining <= 0) return;
    const timestamp = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE control_data_jobs SET cursor_json = ?, updated_at = ?
       WHERE id = ? AND status = 'running'`,
    )
      .bind(toJson({ ...purgeCursor, e2eFailuresRemaining: remaining - 1 }), timestamp, job.id)
      .run();
    throw new Error(`e2e_purge_${phase}_failure`);
  };

  if (!phaseReached("credentials_revoked")) {
    await injectE2eFailure("credential_revocation");
    const revocation = await revokeWorkspaceConnections(env, identity);
    if (revocation.failed > 0) throw new Error("workspace_credential_revocation_incomplete");
    await checkpoint("credentials_revoked");
  }

  if (!phaseReached("durable_objects_purged")) {
    await injectE2eFailure("durable_object_purge");
    const threads = await env.DB.prepare(
      `SELECT thread_id, session_id, user_id, workspace_id, agent_id, status, upstream_json,
              created_at, updated_at, last_seen_at FROM chat_threads
       WHERE workspace_id = ?`,
    )
      .bind(identity.scope.workspaceId)
      .all<ChatThreadRow>();
    for (const thread of threads.results) await threadLifecycleRequest(env, thread, "purge");
    await checkpoint("durable_objects_purged");
  }

  if (!phaseReached("objects_deleted")) {
    await injectE2eFailure("r2_deletion");
    const storageRows = await env.DB.prepare(
      `SELECT storage_key FROM control_artifacts WHERE workspace_id = ? AND storage_key IS NOT NULL
       UNION ALL
       SELECT storage_key FROM control_data_jobs WHERE workspace_id = ? AND storage_key IS NOT NULL`,
    )
      .bind(identity.scope.workspaceId, identity.scope.workspaceId)
      .all<{ storage_key: string }>();
    if (storageRows.results.length && !env.ARTIFACTS)
      throw new Error("artifact_storage_unavailable");
    for (const row of storageRows.results) await env.ARTIFACTS!.delete(row.storage_key);
    await checkpoint("objects_deleted");
  }

  const tables = [
    "control_connection_capabilities",
    "control_connection_oauth_states",
    "control_connections",
    "control_action_ledger",
    "control_action_proposals",
    "control_kill_switches",
    "control_operator_alerts",
    "control_trigger_dispatches",
    "control_triggers",
    "control_managed_state",
    "control_decisions",
    "control_artifacts",
    "control_tool_calls",
    "control_approval_requests",
    "control_runs",
    "control_workflow_intents",
    "control_policy_decisions",
    "tool_permissions",
    "control_plane_events",
    "runtime_spans",
    "runtime_traces",
    "chat_runs",
    "chat_policy_decisions",
    "chat_intents",
    "chat_threads",
    "chat_sessions",
    "active_agent_preferences",
    "memberships",
    "control_retention_policies",
  ];
  const memberUsers = await env.DB.prepare("SELECT user_id FROM memberships WHERE workspace_id = ?")
    .bind(identity.scope.workspaceId)
    .all<{ user_id: string }>();
  const completedAt = new Date().toISOString();
  await injectE2eFailure("d1_rows");
  await injectE2eFailure("receipt_creation");
  const receipt = await sha256Hex(
    new TextEncoder().encode(`${identity.scope.workspaceId}:${completedAt}`),
  );
  await env.DB.batch([
    ...tables.map((table) =>
      env.DB.prepare(`DELETE FROM ${table} WHERE workspace_id = ?`).bind(
        identity.scope.workspaceId,
      ),
    ),
    env.DB.prepare("DELETE FROM agents WHERE workspace_id = ?").bind(identity.scope.workspaceId),
    env.DB.prepare("DELETE FROM active_workspace_preferences WHERE workspace_id = ?").bind(
      identity.scope.workspaceId,
    ),
    env.DB.prepare(
      `INSERT INTO control_deletion_receipts (receipt_sha256, completed_at)
       SELECT ?, ? WHERE EXISTS (
         SELECT 1 FROM workspaces WHERE id = ? AND status = 'purging'
       )`,
    ).bind(receipt, completedAt, identity.scope.workspaceId),
    env.DB.prepare(`DELETE FROM control_data_jobs WHERE workspace_id = ?`).bind(
      identity.scope.workspaceId,
    ),
    env.DB.prepare(`DELETE FROM workspaces WHERE id = ? AND status = 'purging'`).bind(
      identity.scope.workspaceId,
    ),
    ...memberUsers.results.map((member) =>
      env.DB.prepare(
        `DELETE FROM users WHERE id = ?
         AND NOT EXISTS (SELECT 1 FROM memberships WHERE user_id = ?)`,
      ).bind(member.user_id, member.user_id),
    ),
  ]);
};

const workspaceHasActiveExecution = async (env: Env, workspaceId: string) => {
  const row = await env.DB.prepare(
    `SELECT (
       EXISTS (
         SELECT 1 FROM control_runs WHERE workspace_id = ?
         AND status IN ('queued', 'running', 'waiting', 'interrupted')
       ) OR EXISTS (
         SELECT 1 FROM chat_runs WHERE workspace_id = ? AND status = 'running'
       ) OR EXISTS (
         SELECT 1 FROM control_action_proposals WHERE workspace_id = ? AND status = 'executing'
       )
     ) AS active`,
  )
    .bind(workspaceId, workspaceId, workspaceId)
    .first<{ active: number }>();
  return row?.active === 1;
};

const recoverExpiredExportFences = async (env: Env, now: string) => {
  const rows = await env.DB.prepare(
    `SELECT job.id, job.user_id, job.workspace_id, job.kind, job.status, job.cursor_json,
            job.result_json, job.error_json, job.storage_key, job.content_sha256, job.size_bytes,
            job.attempt_count, job.last_error_code, job.last_failed_at, job.manual_retry_count,
            job.lease_owner, job.lease_expires_at, job.expires_at,
            job.created_by_user_id, job.created_at, job.updated_at, job.completed_at
     FROM control_workspace_write_fences fence
     JOIN control_data_jobs job ON job.id = fence.job_id
     WHERE (fence.status = 'active' AND fence.lease_expires_at <= ?)
        OR fence.status = 'releasing'
     ORDER BY fence.lease_expires_at ASC LIMIT 10`,
  )
    .bind(now)
    .all<ControlDataJobRow>();
  for (const job of rows.results) {
    try {
      await releaseExportFence(env, job);
      await clearExportSnapshot(env, job.id);
      await env.DB.prepare(
        `UPDATE control_data_jobs SET status = 'queued', cursor_json = ?, lease_owner = NULL,
           lease_expires_at = NULL, updated_at = ?
         WHERE id = ? AND status IN ('queued', 'running')`,
      )
        .bind(toJson({ phase: "awaiting_quiescence" } satisfies ExportSnapshotCursor), now, job.id)
        .run();
    } catch (error) {
      const errorCode =
        error instanceof Error
          ? error.message.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 96)
          : "workspace_export_recovery_failed";
      await prepareOperatorAlertStatement(env, {
        userId: job.user_id,
        workspaceId: job.workspace_id,
        severity: "critical",
        code: "workspace_export_fence_recovery_failed",
        summary: "An expired workspace export fence could not fully unfreeze chat state.",
        targetType: "dataJob",
        targetId: job.id,
        dedupKey: `workspace-export:${job.id}:recovery`,
        data: { errorCode },
        timestamp: now,
      })
        .run()
        .catch(() => undefined);
      console.error("Expired workspace export fence recovery failed", {
        jobId: job.id,
        error: errorCode,
      });
    }
  }
};

const claimJob = async (env: Env, row: ControlDataJobRow, owner: string, now: string) => {
  const leaseExpiresAt = new Date(Date.parse(now) + 15 * 60 * 1_000).toISOString();
  const result = await env.DB.prepare(
    `UPDATE control_data_jobs SET status = 'running', lease_owner = ?, lease_expires_at = ?,
       attempt_count = attempt_count + 1, updated_at = ?
     WHERE id = ? AND status IN ('queued', 'running')
       AND (lease_expires_at IS NULL OR lease_expires_at <= ?)`,
  )
    .bind(owner, leaseExpiresAt, now, row.id, now)
    .run();
  return ((result as { meta?: { changes?: number } }).meta?.changes ?? 0) > 0;
};

export const processDataLifecycleJobs = async (
  env: Env,
  input: { now?: Date; owner?: string; limit?: number } = {},
) => {
  if (!retainedDataEnabled(env)) return { inspected: 0, completed: 0, failed: 0 };
  const now = (input.now ?? new Date()).toISOString();
  await recoverExpiredExportFences(env, now);
  const rows = await env.DB.prepare(
    `SELECT id, user_id, workspace_id, kind, status, cursor_json, result_json, error_json,
            storage_key, content_sha256, size_bytes, attempt_count, last_error_code,
            last_failed_at, manual_retry_count, lease_owner,
            lease_expires_at, expires_at, created_by_user_id, created_at, updated_at, completed_at
     FROM control_data_jobs WHERE status IN ('queued', 'running')
       AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
       AND (kind = 'export' OR expires_at IS NULL OR expires_at <= ?)
     ORDER BY created_at ASC LIMIT ?`,
  )
    .bind(now, now, Math.max(1, Math.min(10, input.limit ?? 2)))
    .all<ControlDataJobRow>();
  let completed = 0;
  let failed = 0;
  const owner = input.owner ?? `lifecycle:${crypto.randomUUID()}`;
  for (const row of rows.results) {
    if (row.kind === "export" && (await workspaceHasActiveExecution(env, row.workspace_id))) {
      continue;
    }
    if (!(await claimJob(env, row, owner, now))) continue;
    const identity: AgentIdentity = {
      scope: { userId: row.user_id, workspaceId: row.workspace_id },
      agentId: "lifecycle",
    };
    try {
      const claimed = { ...row, status: "running" as const, attempt_count: row.attempt_count + 1 };
      if (row.kind === "export") await runExportJob(env, identity, claimed);
      else await purgeWorkspace(env, identity, claimed);
      completed += 1;
    } catch (error) {
      failed += 1;
      const timestamp = new Date().toISOString();
      const retryable = row.attempt_count + 1 < 3;
      const errorCode =
        error instanceof Error
          ? error.message
              .split(":", 1)[0]
              .replace(/[^a-zA-Z0-9_.-]/g, "_")
              .slice(0, 96)
          : "data_job_failed";
      await env.DB.prepare(
        `UPDATE control_data_jobs SET status = ?, error_json = ?, lease_owner = NULL,
           lease_expires_at = NULL, last_error_code = ?, last_failed_at = ?, updated_at = ?
         WHERE id = ? AND status = 'running'`,
      )
        .bind(
          retryable ? "queued" : "failed",
          toJson({ code: errorCode }),
          errorCode,
          timestamp,
          timestamp,
          row.id,
        )
        .run();
      if (!retryable) {
        if (row.kind === "export") {
          await releaseExportFence(env, row).catch(() => undefined);
          await clearExportSnapshot(env, row.id).catch(() => undefined);
        }
        const failureStatements = [
          prepareOperatorAlertStatement(env, {
            userId: row.user_id,
            workspaceId: row.workspace_id,
            severity: "critical",
            code: "data_lifecycle_job_failed",
            summary: "A customer-data lifecycle job exhausted automatic retries.",
            targetType: "dataJob",
            targetId: row.id,
            dedupKey: `data-lifecycle:${row.id}:failed`,
            data: { kind: row.kind, attempts: row.attempt_count + 1 },
            timestamp,
          }),
        ];
        if (row.kind === "purge") {
          failureStatements.unshift(
            env.DB.prepare(
              `UPDATE workspaces SET status = 'failed', updated_at = ?
             WHERE id = ? AND status = 'purging'`,
            ).bind(timestamp, row.workspace_id),
          );
        }
        await env.DB.batch(failureStatements);
      }
    }
  }
  return { inspected: rows.results.length, completed, failed };
};

export const retryQuarantinedCredentialRevocations = async (
  env: Env,
  input: { limit?: number } = {},
) => {
  const rows = await env.DB.prepare(
    `SELECT id, deletion_requested_by_user_id FROM workspaces
     WHERE status = 'quarantined' AND deletion_requested_by_user_id IS NOT NULL
       AND (
         EXISTS (SELECT 1 FROM control_connections connection
                 WHERE connection.workspace_id = workspaces.id AND connection.status <> 'revoked')
         OR EXISTS (SELECT 1 FROM control_connection_oauth_states oauth
                    WHERE oauth.workspace_id = workspaces.id)
       )
     ORDER BY deletion_requested_at ASC LIMIT ?`,
  )
    .bind(Math.max(1, Math.min(25, input.limit ?? 5)))
    .all<{ id: string; deletion_requested_by_user_id: string }>();
  let completed = 0;
  let failed = 0;
  for (const workspace of rows.results) {
    const identity: AgentIdentity = {
      scope: {
        userId: workspace.deletion_requested_by_user_id,
        workspaceId: workspace.id,
      },
      agentId: "lifecycle",
    };
    const result = await revokeWorkspaceConnections(env, identity);
    if (result.failed > 0) {
      failed += 1;
      continue;
    }
    completed += 1;
    await env.DB.prepare(
      `UPDATE control_operator_alerts SET status = 'resolved', updated_at = ?
       WHERE workspace_id = ? AND code = 'workspace_credential_revocation_incomplete'
         AND status = 'open'`,
    )
      .bind(new Date().toISOString(), workspace.id)
      .run();
  }
  return { inspected: rows.results.length, completed, failed };
};

export const expireDataExports = async (env: Env, now = new Date()) => {
  const timestamp = now.toISOString();
  const rows = await env.DB.prepare(
    `SELECT id, storage_key FROM control_data_jobs
     WHERE kind = 'export' AND status = 'completed' AND expires_at <= ? LIMIT 25`,
  )
    .bind(timestamp)
    .all<{ id: string; storage_key: string | null }>();
  for (const row of rows.results) {
    if (row.storage_key && env.ARTIFACTS) await env.ARTIFACTS.delete(row.storage_key);
    await env.DB.prepare(
      `UPDATE control_data_jobs SET status = 'expired', storage_key = NULL, updated_at = ?
       WHERE id = ? AND status = 'completed'`,
    )
      .bind(timestamp, row.id)
      .run();
  }
  return { expired: rows.results.length };
};

export const handleCreateWorkspaceExport = async (
  request: Request,
  env: Env,
  identity: AgentIdentity,
  waitUntil?: (promise: Promise<unknown>) => void,
) => {
  if (!retainedDataEnabled(env))
    return json(
      {
        ok: false,
        code: "retained_data_disabled",
        error: "Retained-data operations are disabled.",
      },
      { status: 503 },
    );
  const adminError = await requireLifecycleAdmin(env, identity);
  if (adminError) return adminError;
  if (!env.ARTIFACTS || !env.WorkbenchThreadChatAgent)
    return json({ ok: false, error: "Complete export storage is unavailable." }, { status: 503 });
  const body = await request.json().catch(() => null);
  const requestedFailurePhase =
    request.headers.get("x-workbench-e2e-export-failure-phase")?.trim() ??
    new URL(request.url).searchParams.get("e2eFailPhase")?.trim() ??
    (isRecord(body) ? String(body.e2eFailPhase ?? "") : "");
  const e2eFailPhase =
    lifecycleFaultInjectionEnabled(env) &&
    ["after_d1_materialized", "after_r2_pinned", "assembling"].includes(requestedFailurePhase)
      ? (requestedFailurePhase as NonNullable<ExportSnapshotCursor["e2eFailPhase"]>)
      : undefined;
  const id = createId("cf-data-export");
  const timestamp = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO control_data_jobs (id, user_id, workspace_id, kind, status, cursor_json,
       created_by_user_id, created_at, updated_at)
     VALUES (?, ?, ?, 'export', 'queued', ?, ?, ?, ?)`,
  )
    .bind(
      id,
      identity.scope.userId,
      identity.scope.workspaceId,
      toJson({
        phase: "awaiting_quiescence",
        e2eFailPhase,
        e2eFailuresRemaining: e2eFailPhase ? 1 : undefined,
      } satisfies ExportSnapshotCursor),
      identity.scope.userId,
      timestamp,
      timestamp,
    )
    .run();
  waitUntil?.(processDataLifecycleJobs(env, { owner: `request:${id}`, limit: 1 }));
  return json(
    {
      ok: true,
      job: {
        id,
        kind: "export",
        status: "queued",
        createdAt: timestamp,
        ...(lifecycleFaultInjectionEnabled(env) && e2eFailPhase
          ? { injectedFailurePhase: e2eFailPhase }
          : {}),
      },
    },
    { status: 202 },
  );
};

export const handleGetWorkspaceDataJob = async (
  env: Env,
  identity: AgentIdentity,
  jobId: string,
) => {
  const adminError = await requireLifecycleAdmin(env, identity);
  if (adminError) return adminError;
  const row = await selectJob(env, identity, jobId);
  return row
    ? json({ ok: true, job: jobSummary(row) })
    : json({ ok: false, error: "Data job not found." }, { status: 404 });
};

export const handleDownloadWorkspaceExport = async (
  env: Env,
  identity: AgentIdentity,
  jobId: string,
) => {
  const adminError = await requireLifecycleAdmin(env, identity);
  if (adminError) return adminError;
  const row = await selectJob(env, identity, jobId);
  if (!row || row.kind !== "export")
    return json({ ok: false, error: "Data export not found." }, { status: 404 });
  if (row.status !== "completed" || !row.storage_key || !env.ARTIFACTS)
    return json(
      { ok: false, code: "export_not_ready", error: "Data export is not ready." },
      { status: 409 },
    );
  if (row.expires_at && row.expires_at <= new Date().toISOString())
    return json({ ok: false, error: "Data export expired." }, { status: 410 });
  const object = await env.ARTIFACTS.get(row.storage_key);
  if (!object)
    return json({ ok: false, error: "Data export content is unavailable." }, { status: 410 });
  return new Response(object.body, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="assistant-mk1-${encodeURIComponent(identity.scope.workspaceId)}-export.zip"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "x-content-sha256": row.content_sha256 ?? "",
    },
  });
};

export const handleRequestWorkspaceDeletion = async (
  request: Request,
  env: Env,
  identity: AgentIdentity,
) => {
  if (!retainedDataEnabled(env))
    return json(
      {
        ok: false,
        code: "retained_data_disabled",
        error: "Retained-data operations are disabled.",
      },
      { status: 503 },
    );
  const ownerError = await requireLifecycleOwner(env, identity);
  if (ownerError) return ownerError;
  const workspace = await selectWorkspace(env, identity.scope.workspaceId);
  if (!workspace) return json({ ok: false, error: "Workspace not found." }, { status: 404 });
  if (workspace.status !== "active")
    return json(
      { ok: false, code: "workspace_not_active", error: "Workspace is not active." },
      { status: 409 },
    );
  const activeExport = await env.DB.prepare(
    `SELECT id FROM control_data_jobs
     WHERE workspace_id = ? AND kind = 'export' AND status IN ('queued', 'running') LIMIT 1`,
  )
    .bind(identity.scope.workspaceId)
    .first<{ id: string }>();
  if (activeExport) {
    return json(
      {
        ok: false,
        code: "workspace_export_in_progress",
        error: "Workspace deletion must wait for the active data export to finish.",
      },
      { status: 409 },
    );
  }
  const body = await request.json().catch(() => null);
  const reauthenticatedAt =
    isRecord(body) && typeof body.reauthenticatedAt === "string"
      ? Date.parse(body.reauthenticatedAt)
      : NaN;
  const workspaceName =
    isRecord(body) && typeof body.workspaceName === "string" ? body.workspaceName.trim() : "";
  if (
    workspaceName !== workspace.name ||
    !Number.isFinite(reauthenticatedAt) ||
    reauthenticatedAt > Date.now() + 30_000 ||
    Date.now() - reauthenticatedAt > reauthenticationMaxAgeMs
  ) {
    return json(
      {
        ok: false,
        code: "reauthentication_required",
        error: "Fresh reauthentication and exact workspace-name confirmation are required.",
      },
      { status: 403 },
    );
  }
  const timestamp = new Date().toISOString();
  const e2eFailPhase =
    lifecycleFaultInjectionEnabled(env) &&
    isRecord(body) &&
    [
      "credential_revocation",
      "durable_object_purge",
      "r2_deletion",
      "d1_rows",
      "receipt_creation",
    ].includes(String(body.e2eFailPhase))
      ? String(body.e2eFailPhase)
      : undefined;
  const purgeAfter = e2eFailPhase
    ? new Date(Date.now() - 1_000).toISOString()
    : new Date(Date.now() + deletionRecoveryMs).toISOString();
  const purgeJobId = createId("cf-data-purge");
  const transition = await env.DB.batch([
    env.DB.prepare(
      `UPDATE workspaces SET status = 'quarantined', deletion_requested_by_user_id = ?,
         deletion_requested_at = ?, purge_after = ?, updated_at = ?
       WHERE id = ? AND status = 'active' AND updated_at = ?`,
    ).bind(
      identity.scope.userId,
      timestamp,
      purgeAfter,
      timestamp,
      identity.scope.workspaceId,
      workspace.updated_at,
    ),
    env.DB.prepare(
      `UPDATE control_triggers SET status = 'paused', secret_hash = NULL, version = version + 1,
         updated_at = ? WHERE workspace_id = ? AND status = 'enabled'`,
    ).bind(timestamp, identity.scope.workspaceId),
    env.DB.prepare(
      `UPDATE control_runs SET status = 'cancelled', cancelled_at = ?, updated_at = ?
       WHERE workspace_id = ? AND status IN ('queued', 'running', 'waiting', 'interrupted')`,
    ).bind(timestamp, timestamp, identity.scope.workspaceId),
    env.DB.prepare(
      `UPDATE control_workflow_intents SET status = 'cancelled', updated_at = ?
       WHERE workspace_id = ? AND status IN ('queued', 'running', 'waiting', 'interrupted')`,
    ).bind(timestamp, identity.scope.workspaceId),
    env.DB.prepare(
      `UPDATE control_approval_requests SET status = 'cancelled', updated_at = ?
       WHERE workspace_id = ? AND status = 'requested'`,
    ).bind(timestamp, identity.scope.workspaceId),
    env.DB.prepare(
      `UPDATE control_tool_calls SET status = 'cancelled', finished_at = ?,
         data_json = json_set(data_json, '$.cancellationReason', 'workspace_quarantined')
       WHERE workspace_id = ? AND status IN ('queued', 'running', 'waiting')`,
    ).bind(timestamp, identity.scope.workspaceId),
    env.DB.prepare(
      `INSERT INTO control_action_ledger (
         id, user_id, workspace_id, agent_id, proposal_id, sequence, status, summary,
         data_json, created_at
       ) SELECT 'cf-action-ledger-' || lower(hex(randomblob(16))), proposal.user_id,
         proposal.workspace_id, proposal.agent_id, proposal.id,
         COALESCE((SELECT MAX(existing.sequence) FROM control_action_ledger existing
                   WHERE existing.proposal_id = proposal.id), 0) + 1,
         'cancelled', 'Workspace deletion revoked pending mutation authority.', '{}', ?
       FROM control_action_proposals proposal WHERE proposal.workspace_id = ?
         AND proposal.status IN ('proposed', 'approval_requested', 'approved', 'executing')`,
    ).bind(timestamp, identity.scope.workspaceId),
    env.DB.prepare(
      `UPDATE control_action_proposals SET status = 'cancelled',
         error_json = '{"code":"workspace_quarantined"}', terminal_at = ?,
         version = version + 1, updated_at = ? WHERE workspace_id = ?
         AND status IN ('proposed', 'approval_requested', 'approved', 'executing')`,
    ).bind(timestamp, timestamp, identity.scope.workspaceId),
    env.DB.prepare(
      `INSERT INTO control_kill_switches (id, user_id, workspace_id, scope_kind, scope_id, enabled,
         reason, created_by_user_id, version, created_at, updated_at)
       SELECT ?, ?, ?, 'workspace', ?, 1, 'Workspace is pending deletion.', ?, 1, ?, ?
       WHERE EXISTS (SELECT 1 FROM workspaces WHERE id = ? AND status = 'quarantined' AND updated_at = ?)
       ON CONFLICT(user_id, workspace_id, scope_kind, scope_id) DO UPDATE SET
         enabled = 1, reason = excluded.reason, version = control_kill_switches.version + 1,
         updated_at = excluded.updated_at`,
    ).bind(
      createId("cf-kill-switch"),
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.scope.workspaceId,
      identity.scope.userId,
      timestamp,
      timestamp,
      identity.scope.workspaceId,
      timestamp,
    ),
    env.DB.prepare(
      `INSERT INTO control_data_jobs (id, user_id, workspace_id, kind, status, cursor_json,
         expires_at, created_by_user_id, created_at, updated_at)
       SELECT ?, ?, ?, 'purge', 'queued', ?, ?, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM workspaces WHERE id = ? AND status = 'quarantined' AND updated_at = ?)`,
    ).bind(
      purgeJobId,
      identity.scope.userId,
      identity.scope.workspaceId,
      toJson(e2eFailPhase ? { e2eFailPhase, e2eFailuresRemaining: 3 } : {}),
      purgeAfter,
      identity.scope.userId,
      timestamp,
      timestamp,
      identity.scope.workspaceId,
      timestamp,
    ),
  ]);
  if ((transition[0]?.meta?.changes ?? 0) === 0) {
    return json(
      {
        ok: false,
        code: "workspace_transition_conflict",
        error: "Workspace deletion lost a concurrent transition.",
      },
      { status: 409 },
    );
  }
  const revocation = await revokeWorkspaceConnections(env, identity);
  if (revocation.failed > 0) {
    await prepareOperatorAlertStatement(env, {
      userId: identity.scope.userId,
      workspaceId: identity.scope.workspaceId,
      severity: "critical",
      code: "workspace_credential_revocation_incomplete",
      summary: "Workspace access is quarantined, but credential cleanup requires retry.",
      targetType: "workspace",
      targetId: identity.scope.workspaceId,
      dedupKey: `workspace-credential-revocation:${identity.scope.workspaceId}`,
      data: { failed: revocation.failed },
      timestamp,
    }).run();
  }
  return json(
    {
      ok: true,
      deletion: {
        status: "quarantined",
        requestedAt: timestamp,
        purgeAfter,
        purgeJobId,
        credentialsRecoverable: false,
        credentialRevocation: revocation.failed === 0 ? "completed" : "pending_retry",
      },
    },
    { status: 202 },
  );
};

export const handleGetWorkspaceDeletion = async (env: Env, identity: AgentIdentity) => {
  const workspace = await selectWorkspace(env, identity.scope.workspaceId);
  if (!workspace || !["quarantined", "purging", "failed"].includes(workspace.status)) {
    return json({ ok: false, error: "Workspace deletion not found." }, { status: 404 });
  }
  if (workspace.deletion_requested_by_user_id !== identity.scope.userId)
    return json({ ok: false, error: "Workspace deletion not found." }, { status: 404 });
  const job = await env.DB.prepare(
    `SELECT id, status, cursor_json, attempt_count, manual_retry_count, last_error_code,
            last_failed_at, created_at, updated_at
     FROM control_data_jobs
     WHERE workspace_id = ? AND kind = 'purge'
     ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(identity.scope.workspaceId)
    .first<{
      id: string;
      status: string;
      cursor_json: string;
      attempt_count: number;
      manual_retry_count: number;
      last_error_code: string | null;
      last_failed_at: string | null;
      created_at: string;
      updated_at: string;
    }>();
  const cursor = parseDataJson(job?.cursor_json ?? "{}");
  return json({
    ok: true,
    deletion: {
      status: workspace.status,
      requestedAt: workspace.deletion_requested_at,
      purgeAfter: workspace.purge_after,
      credentialsRecoverable: false,
      purgeJobId: job?.id,
      phase: typeof cursor.phase === "string" ? cursor.phase : undefined,
      attemptCount: job?.attempt_count,
      manualRetryCount: job?.manual_retry_count,
      lastErrorCode: job?.last_error_code ?? undefined,
      lastFailedAt: job?.last_failed_at ?? undefined,
      canRetry: workspace.status === "failed" && job?.status === "failed",
      canRecover: workspace.status === "quarantined",
    },
  });
};

const queueFailedWorkspacePurge = async (
  env: Env,
  input: {
    workspaceId: string;
    jobId: string;
    actorUserId: string;
    actorAgentId: string;
    source: "initiating_owner" | "platform_operator";
    reason: string;
    requireOpenCriticalAlert: boolean;
  },
) => {
  const timestamp = new Date().toISOString();
  const data = toJson({ source: input.source, reason: input.reason });
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE workspaces SET status = 'purging', updated_at = ?
       WHERE id = ? AND status = 'failed'
         AND EXISTS (SELECT 1 FROM control_data_jobs WHERE id = ? AND workspace_id = ?
                     AND kind = 'purge' AND status = 'failed')
         AND (? = 0 OR EXISTS (
           SELECT 1 FROM control_operator_alerts WHERE workspace_id = ?
             AND target_type = 'dataJob' AND target_id = ?
             AND code = 'data_lifecycle_job_failed' AND severity = 'critical'
             AND status = 'open'
         ))`,
    ).bind(
      timestamp,
      input.workspaceId,
      input.jobId,
      input.workspaceId,
      input.requireOpenCriticalAlert ? 1 : 0,
      input.workspaceId,
      input.jobId,
    ),
    env.DB.prepare(
      `UPDATE control_data_jobs SET status = 'queued', lease_owner = NULL,
         lease_expires_at = NULL, manual_retry_count = manual_retry_count + 1, updated_at = ?
       WHERE id = ? AND workspace_id = ? AND kind = 'purge' AND status = 'failed'
         AND EXISTS (SELECT 1 FROM workspaces WHERE id = ? AND status = 'purging'
                     AND updated_at = ?)`,
    ).bind(timestamp, input.jobId, input.workspaceId, input.workspaceId, timestamp),
    env.DB.prepare(
      `UPDATE control_operator_alerts SET status = 'acknowledged', updated_at = ?
       WHERE workspace_id = ? AND target_type = 'dataJob' AND target_id = ?
         AND code = 'data_lifecycle_job_failed' AND status = 'open'`,
    ).bind(timestamp, input.workspaceId, input.jobId),
    env.DB.prepare(
      `INSERT INTO control_audit_events (
         id, user_id, workspace_id, action, summary, target_type, target_id, data_json, created_at
       ) SELECT ?, ?, ?, 'workspace.purge.retry_requested', ?, 'dataJob', ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM control_data_jobs WHERE id = ? AND status = 'queued'
                     AND updated_at = ?)`,
    ).bind(
      createId("cf-audit"),
      input.actorUserId,
      input.workspaceId,
      input.source === "platform_operator"
        ? "A platform operator requested recovery of an orphaned failed workspace purge."
        : "An owner requested a manual retry of a failed workspace purge.",
      input.jobId,
      data,
      timestamp,
      input.jobId,
      timestamp,
    ),
    env.DB.prepare(
      `INSERT INTO control_plane_events (
         id, user_id, workspace_id, agent_id, type, summary, target_type, target_id,
         data_json, created_at
       ) SELECT ?, ?, ?, ?, 'workspace.purge.retry_requested',
         'Failed workspace purge queued for manual retry.', 'dataJob', ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM control_data_jobs WHERE id = ? AND status = 'queued'
                     AND updated_at = ?)`,
    ).bind(
      createId("cf-event"),
      input.actorUserId,
      input.workspaceId,
      input.actorAgentId,
      input.jobId,
      data,
      timestamp,
      input.jobId,
      timestamp,
    ),
  ]);
  return {
    queued: (results[0]?.meta?.changes ?? 0) > 0 && (results[1]?.meta?.changes ?? 0) > 0,
    timestamp,
  };
};

export const handleRetryWorkspaceDeletion = async (
  request: Request,
  env: Env,
  identity: AgentIdentity,
) => {
  const ownerError = await requireLifecycleOwner(env, identity);
  if (ownerError) return ownerError;
  const workspace = await selectWorkspace(env, identity.scope.workspaceId);
  if (
    !workspace ||
    workspace.status !== "failed" ||
    workspace.deletion_requested_by_user_id !== identity.scope.userId
  ) {
    return json({ ok: false, error: "Workspace deletion not found." }, { status: 404 });
  }
  const body = await request.json().catch(() => null);
  const reauthenticatedAt =
    isRecord(body) && typeof body.reauthenticatedAt === "string"
      ? Date.parse(body.reauthenticatedAt)
      : NaN;
  const workspaceName =
    isRecord(body) && typeof body.workspaceName === "string" ? body.workspaceName.trim() : "";
  if (
    workspaceName !== workspace.name ||
    !Number.isFinite(reauthenticatedAt) ||
    reauthenticatedAt > Date.now() + 30_000 ||
    Date.now() - reauthenticatedAt > reauthenticationMaxAgeMs
  ) {
    return json(
      {
        ok: false,
        code: "reauthentication_required",
        error: "Fresh reauthentication and exact workspace-name confirmation are required.",
      },
      { status: 403 },
    );
  }
  const job = await env.DB.prepare(
    `SELECT id, status FROM control_data_jobs
     WHERE workspace_id = ? AND kind = 'purge'
     ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(identity.scope.workspaceId)
    .first<{ id: string; status: string }>();
  if (!job || job.status !== "failed") {
    return json(
      { ok: false, code: "purge_retry_conflict", error: "Workspace purge is not retryable." },
      { status: 409 },
    );
  }
  const retry = await queueFailedWorkspacePurge(env, {
    workspaceId: identity.scope.workspaceId,
    jobId: job.id,
    actorUserId: identity.scope.userId,
    actorAgentId: identity.agentId,
    source: "initiating_owner",
    reason: "Initiating owner requested manual retry.",
    requireOpenCriticalAlert: false,
  });
  if (!retry.queued) {
    return json(
      {
        ok: false,
        code: "purge_retry_conflict",
        error: "Workspace purge retry lost a concurrent transition.",
      },
      { status: 409 },
    );
  }
  return json(
    {
      ok: true,
      deletion: {
        status: "purging",
        purgeJobId: job.id,
        credentialsRecoverable: false,
        canRetry: false,
      },
    },
    { status: 202 },
  );
};

export const handleOperatorRetryWorkspaceDeletion = async (
  request: Request,
  env: Env,
  operator: AgentIdentity,
  targetWorkspaceId: string,
  signedFacade: boolean,
) => {
  if (
    !signedFacade ||
    request.headers.get("x-assistant-mk1-platform-operator")?.trim() !== "true"
  ) {
    return json({ ok: false, error: "Not found." }, { status: 404 });
  }
  const body = await request.json().catch(() => null);
  const workspaceName =
    isRecord(body) && typeof body.workspaceName === "string" ? body.workspaceName.trim() : "";
  const reason = isRecord(body) && typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 10 || reason.length > 500) {
    return json(
      { ok: false, code: "operator_reason_required", error: "An operator reason is required." },
      { status: 400 },
    );
  }
  const workspace = await selectWorkspace(env, targetWorkspaceId);
  if (!workspace || workspace.status !== "failed" || workspace.name !== workspaceName) {
    return json({ ok: false, error: "Workspace deletion not found." }, { status: 404 });
  }
  const job = await env.DB.prepare(
    `SELECT id, status FROM control_data_jobs
     WHERE workspace_id = ? AND kind = 'purge'
     ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(targetWorkspaceId)
    .first<{ id: string; status: string }>();
  if (!job || job.status !== "failed") {
    return json({ ok: false, error: "Workspace deletion not found." }, { status: 404 });
  }
  const retry = await queueFailedWorkspacePurge(env, {
    workspaceId: targetWorkspaceId,
    jobId: job.id,
    actorUserId: operator.scope.userId,
    actorAgentId: operator.agentId,
    source: "platform_operator",
    reason,
    requireOpenCriticalAlert: true,
  });
  if (!retry.queued) {
    return json(
      {
        ok: false,
        code: "purge_retry_conflict",
        error: "Workspace purge is not retryable or its critical alert is not open.",
      },
      { status: 409 },
    );
  }
  return json(
    {
      ok: true,
      deletion: {
        status: "purging",
        purgeJobId: job.id,
        credentialsRecoverable: false,
        canRetry: false,
      },
    },
    { status: 202 },
  );
};

export const handleRecoverWorkspace = async (env: Env, identity: AgentIdentity) => {
  const workspace = await selectWorkspace(env, identity.scope.workspaceId);
  if (
    !workspace ||
    workspace.status !== "quarantined" ||
    workspace.deletion_requested_by_user_id !== identity.scope.userId
  ) {
    return json({ ok: false, error: "Workspace deletion not found." }, { status: 404 });
  }
  if (!workspace.purge_after || workspace.purge_after <= new Date().toISOString())
    return json(
      { ok: false, code: "recovery_expired", error: "Workspace recovery period has expired." },
      { status: 410 },
    );
  const revocation = await revokeWorkspaceConnections(env, identity);
  if (revocation.failed > 0) {
    return json(
      {
        ok: false,
        code: "credential_revocation_incomplete",
        error: "Workspace recovery is blocked until credential cleanup succeeds.",
      },
      { status: 503 },
    );
  }
  const timestamp = new Date().toISOString();
  const recovered = await env.DB.batch([
    env.DB.prepare(
      `UPDATE workspaces SET status = 'active', deletion_requested_by_user_id = NULL,
         deletion_requested_at = NULL, purge_after = NULL, updated_at = ?
       WHERE id = ? AND status = 'quarantined' AND updated_at = ?`,
    ).bind(timestamp, identity.scope.workspaceId, workspace.updated_at),
    env.DB.prepare(
      `UPDATE control_data_jobs SET status = 'cancelled', updated_at = ?
       WHERE user_id = ? AND workspace_id = ? AND kind = 'purge' AND status IN ('queued', 'running')
         AND EXISTS (SELECT 1 FROM workspaces WHERE id = ? AND status = 'active' AND updated_at = ?)`,
    ).bind(
      timestamp,
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.scope.workspaceId,
      timestamp,
    ),
    env.DB.prepare(
      `UPDATE control_kill_switches SET enabled = 0, reason = 'Workspace deletion was recovered.',
         version = version + 1, updated_at = ? WHERE user_id = ? AND workspace_id = ?
         AND scope_kind = 'workspace' AND scope_id = ?
         AND EXISTS (SELECT 1 FROM workspaces WHERE id = ? AND status = 'active' AND updated_at = ?)`,
    ).bind(
      timestamp,
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.scope.workspaceId,
      identity.scope.workspaceId,
      timestamp,
    ),
  ]);
  if ((recovered[0]?.meta?.changes ?? 0) === 0) {
    return json(
      {
        ok: false,
        code: "workspace_transition_conflict",
        error: "Workspace recovery lost a concurrent purge transition.",
      },
      { status: 409 },
    );
  }
  return json({
    ok: true,
    deletion: {
      status: "recovered",
      recoveredAt: timestamp,
      credentialsRestored: false,
      triggersRestored: false,
    },
  });
};

export const handleWorkspaceDeletionPlan = async (env: Env, identity: AgentIdentity) => {
  const adminError = await requireLifecycleAdmin(env, identity);
  if (adminError) return adminError;
  const collections = await loadCollections(env, identity);
  const r2Objects = (
    (collections.control_artifacts ?? []) as unknown as ControlArtifactRow[]
  ).filter((artifact) => artifact.storage_provider === "r2" && !artifact.deleted_at).length;
  const executable = retainedDataEnabled(env);
  return json({
    ok: true,
    plan: {
      scope: identity.scope,
      d1RowsByCollection: Object.fromEntries(
        Object.entries(collections).map(([name, rows]) => [name, rows.length]),
      ),
      r2Objects,
      executable,
      recoveryDays: 30,
      blockers: executable
        ? []
        : [
            "Retained-data lifecycle feature gate is disabled.",
            "Use the asynchronous export and deletion evidence gates before enabling it.",
          ],
      irreversibleOnConfirmation: [
        "connection credentials",
        "webhook secrets",
        "pending approvals",
      ],
    },
  });
};
