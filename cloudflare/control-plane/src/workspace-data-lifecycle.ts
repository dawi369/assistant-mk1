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
  type Env,
} from "./types";

const exportExpiryMs = 7 * 24 * 60 * 60 * 1_000;
const deletionRecoveryMs = 30 * 24 * 60 * 60 * 1_000;
const reauthenticationMaxAgeMs = 5 * 60 * 1_000;
const maximumExportBytes = 110 * 1024 * 1024;
const collectionPageSize = 500;
const maximumCollectionRows = 50_000;

type ExportCollection = {
  name: string;
  query: string;
  bindings: (identity: AgentIdentity) => unknown[];
};

const tenantCollection = (name: string, select = "*"): ExportCollection => ({
  name,
  query: `SELECT ${select} FROM ${name} WHERE workspace_id = ?`,
  bindings: (identity) => [identity.scope.workspaceId],
});

const exportCollections: readonly ExportCollection[] = [
  {
    name: "users",
    query:
      "SELECT * FROM users WHERE id IN (SELECT user_id FROM memberships WHERE workspace_id = ?)",
    bindings: (identity) => [identity.scope.workspaceId],
  },
  {
    name: "workspaces",
    query: "SELECT * FROM workspaces WHERE id = ?",
    bindings: (identity) => [identity.scope.workspaceId],
  },
  tenantCollection("active_workspace_preferences"),
  tenantCollection("memberships"),
  {
    name: "agents",
    query: "SELECT * FROM agents WHERE workspace_id = ?",
    bindings: (identity) => [identity.scope.workspaceId],
  },
  tenantCollection("active_agent_preferences"),
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
  tenantCollection("control_retention_policies"),
  tenantCollection("control_plane_events"),
  tenantCollection("runtime_traces"),
  tenantCollection("runtime_spans"),
  tenantCollection("chat_sessions"),
  tenantCollection("chat_threads"),
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

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
};

const loadCollection = async (env: Env, identity: AgentIdentity, collection: ExportCollection) => {
  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; offset < maximumCollectionRows; offset += collectionPageSize) {
    const page = await env.DB.prepare(`${collection.query} LIMIT ? OFFSET ?`)
      .bind(...collection.bindings(identity), collectionPageSize, offset)
      .all<Record<string, unknown>>();
    rows.push(...page.results);
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
            storage_key, content_sha256, size_bytes, attempt_count, lease_owner,
            lease_expires_at, expires_at, created_by_user_id, created_at, updated_at, completed_at
     FROM control_data_jobs WHERE id = ? AND user_id = ? AND workspace_id = ? LIMIT 1`,
  )
    .bind(jobId, identity.scope.userId, identity.scope.workspaceId)
    .first<ControlDataJobRow>();

const threadLifecycleRequest = async (
  env: Env,
  thread: ChatThreadRow,
  action: "export" | "purge",
) => {
  if (!env.WorkbenchThreadChatAgent || !env.WORKBENCH_AGENT_CONNECTION_SECRET) {
    throw new Error("durable_object_lifecycle_unavailable");
  }
  const name = await resolveThreadAgentInstanceName(thread);
  const stub = env.WorkbenchThreadChatAgent.get(env.WorkbenchThreadChatAgent.idFromName(name));
  const response = await stub.fetch(`https://thread-agent.internal/internal/lifecycle-${action}`, {
    method: "POST",
    headers: { "x-workbench-lifecycle-secret": env.WORKBENCH_AGENT_CONNECTION_SECRET },
  });
  if (!response.ok) throw new Error(`durable_object_${action}_failed`);
  return action === "export" ? ((await response.json()) as { messages?: unknown[] }) : null;
};

const loadThreadMessages = async (env: Env, identity: AgentIdentity) => {
  const threads = await env.DB.prepare(
    `SELECT thread_id, session_id, user_id, workspace_id, agent_id, status, upstream_json,
            created_at, updated_at, last_seen_at
     FROM chat_threads WHERE workspace_id = ? ORDER BY created_at ASC`,
  )
    .bind(identity.scope.workspaceId)
    .all<ChatThreadRow>();
  const messages: Record<string, unknown>[] = [];
  for (const thread of threads.results) {
    const exported = await threadLifecycleRequest(env, thread, "export");
    messages.push({ threadId: thread.thread_id, messages: exported?.messages ?? [] });
  }
  return { threads: threads.results, messages };
};

const exportStorageKey = (identity: AgentIdentity, jobId: string) =>
  [
    "tenants",
    encodeURIComponent(identity.scope.userId),
    encodeURIComponent(identity.scope.workspaceId),
    "exports",
    `${encodeURIComponent(jobId)}.zip`,
  ].join("/");

const runExportJob = async (env: Env, identity: AgentIdentity, job: ControlDataJobRow) => {
  if (!env.ARTIFACTS) throw new Error("artifact_storage_unavailable");
  const collections = await loadCollections(env, identity);
  const threadState = await loadThreadMessages(env, identity);
  const entries: Array<{ name: string; content: Uint8Array }> = [];
  for (const [name, rows] of Object.entries(collections)) {
    entries.push(
      textZipEntry(`d1/${name}.ndjson`, rows.map((row) => JSON.stringify(row)).join("\n")),
    );
  }
  entries.push(
    textZipEntry(
      "durable-objects/thread-messages.ndjson",
      threadState.messages.map((row) => JSON.stringify(row)).join("\n"),
    ),
  );

  const artifacts = (collections.control_artifacts ?? []) as unknown as ControlArtifactRow[];
  for (const artifact of artifacts) {
    if (artifact.storage_provider !== "r2" || !artifact.storage_key || artifact.deleted_at)
      continue;
    const object = await env.ARTIFACTS.get(artifact.storage_key);
    if (!object) throw new Error(`artifact_content_missing:${artifact.id}`);
    const content = new Uint8Array(await object.arrayBuffer());
    if (!artifact.content_sha256 || (await sha256Hex(content)) !== artifact.content_sha256) {
      throw new Error(`artifact_checksum_mismatch:${artifact.id}`);
    }
    entries.push({ name: `artifacts/${encodeURIComponent(artifact.id)}`, content });
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
    version: 2,
    generatedAt,
    scope: identity.scope,
    collections: Object.fromEntries(
      Object.entries(collections).map(([name, rows]) => [name, rows.length]),
    ),
    durableObjectThreadCount: threadState.threads.length,
    artifactCount: entries.filter((entry) => entry.name.startsWith("artifacts/")).length,
    files: fileEvidence,
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
  const result = await env.DB.prepare(
    `UPDATE control_data_jobs SET status = 'completed', storage_key = ?, content_sha256 = ?,
       size_bytes = ?, result_json = ?, error_json = '{}', lease_owner = NULL,
       lease_expires_at = NULL, expires_at = ?, completed_at = ?, updated_at = ?
     WHERE id = ? AND user_id = ? AND workspace_id = ? AND status = 'running'`,
  )
    .bind(
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
    )
    .run();
  if (((result as { meta?: { changes?: number } }).meta?.changes ?? 0) === 0) {
    await env.ARTIFACTS.delete(storageKey).catch(() => undefined);
    throw new Error("data_job_publication_revoked");
  }
  await env.DB.prepare(
    `INSERT INTO control_audit_events (
       id, user_id, workspace_id, action, summary, target_type, target_id, data_json, created_at
     ) VALUES (?, ?, ?, 'workspace.data.exported', 'Workspace data export completed.',
       'dataJob', ?, ?, ?)`,
  )
    .bind(
      createId("cf-audit"),
      identity.scope.userId,
      identity.scope.workspaceId,
      job.id,
      toJson({ sizeBytes: archive.byteLength, contentSha256: digest }),
      completedAt,
    )
    .run();
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
  const revocation = await revokeWorkspaceConnections(env, identity);
  if (revocation.failed > 0) throw new Error("workspace_credential_revocation_incomplete");
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
  const threads = await env.DB.prepare(
    `SELECT thread_id, session_id, user_id, workspace_id, agent_id, status, upstream_json,
            created_at, updated_at, last_seen_at FROM chat_threads
     WHERE workspace_id = ?`,
  )
    .bind(identity.scope.workspaceId)
    .all<ChatThreadRow>();
  for (const thread of threads.results) await threadLifecycleRequest(env, thread, "purge");

  const storageRows = await env.DB.prepare(
    `SELECT storage_key FROM control_artifacts WHERE workspace_id = ? AND storage_key IS NOT NULL
     UNION ALL
     SELECT storage_key FROM control_data_jobs WHERE workspace_id = ? AND storage_key IS NOT NULL`,
  )
    .bind(identity.scope.workspaceId, identity.scope.workspaceId)
    .all<{ storage_key: string }>();
  if (storageRows.results.length && !env.ARTIFACTS) throw new Error("artifact_storage_unavailable");
  for (const row of storageRows.results) await env.ARTIFACTS!.delete(row.storage_key);

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

const claimJob = async (env: Env, row: ControlDataJobRow, owner: string, now: string) => {
  const leaseExpiresAt = new Date(Date.parse(now) + 2 * 60 * 1_000).toISOString();
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
  const rows = await env.DB.prepare(
    `SELECT id, user_id, workspace_id, kind, status, cursor_json, result_json, error_json,
            storage_key, content_sha256, size_bytes, attempt_count, lease_owner,
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
      await env.DB.prepare(
        `UPDATE control_data_jobs SET status = ?, error_json = ?, lease_owner = NULL,
           lease_expires_at = NULL, updated_at = ? WHERE id = ? AND status = 'running'`,
      )
        .bind(
          retryable ? "queued" : "failed",
          toJson({ code: error instanceof Error ? error.message : "data_job_failed" }),
          timestamp,
          row.id,
        )
        .run();
      if (!retryable) {
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
  const id = createId("cf-data-export");
  const timestamp = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO control_data_jobs (id, user_id, workspace_id, kind, status, created_by_user_id,
       created_at, updated_at) VALUES (?, ?, ?, 'export', 'queued', ?, ?, ?)`,
  )
    .bind(
      id,
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.scope.userId,
      timestamp,
      timestamp,
    )
    .run();
  waitUntil?.(processDataLifecycleJobs(env, { owner: `request:${id}`, limit: 1 }));
  return json(
    { ok: true, job: { id, kind: "export", status: "queued", createdAt: timestamp } },
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
  const purgeAfter = new Date(Date.now() + deletionRecoveryMs).toISOString();
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
      `INSERT INTO control_data_jobs (id, user_id, workspace_id, kind, status, expires_at,
         created_by_user_id, created_at, updated_at)
       SELECT ?, ?, ?, 'purge', 'queued', ?, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM workspaces WHERE id = ? AND status = 'quarantined' AND updated_at = ?)`,
    ).bind(
      purgeJobId,
      identity.scope.userId,
      identity.scope.workspaceId,
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
  if (!workspace || (workspace.status !== "quarantined" && workspace.status !== "purging")) {
    return json({ ok: false, error: "Workspace deletion not found." }, { status: 404 });
  }
  if (workspace.deletion_requested_by_user_id !== identity.scope.userId)
    return json({ ok: false, error: "Workspace deletion not found." }, { status: 404 });
  return json({
    ok: true,
    deletion: {
      status: workspace.status,
      requestedAt: workspace.deletion_requested_at,
      purgeAfter: workspace.purge_after,
      credentialsRecoverable: false,
    },
  });
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

export const handleExportWorkspaceData = async (env: Env, identity: AgentIdentity) => {
  const adminError = await requireLifecycleAdmin(env, identity);
  if (adminError) return adminError;
  try {
    const collections = await loadCollections(env, identity);
    const artifacts = (collections.control_artifacts ?? []) as unknown as ControlArtifactRow[];
    const artifactBlobs: Record<string, unknown>[] = [];
    for (const artifact of artifacts) {
      if (artifact.storage_provider !== "r2" || !artifact.storage_key || artifact.deleted_at)
        continue;
      if (!env.ARTIFACTS) throw new Error("artifact_storage_unavailable");
      const object = await env.ARTIFACTS.get(artifact.storage_key);
      if (!object) throw new Error(`artifact_content_missing:${artifact.id}`);
      const content = new Uint8Array(await object.arrayBuffer());
      if (!artifact.content_sha256 || (await sha256Hex(content)) !== artifact.content_sha256) {
        throw new Error(`artifact_checksum_mismatch:${artifact.id}`);
      }
      artifactBlobs.push({
        artifactId: artifact.id,
        storageKey: artifact.storage_key,
        contentSha256: artifact.content_sha256,
        mimeType: artifact.mime_type,
        sizeBytes: content.byteLength,
        contentBase64: bytesToBase64(content),
      });
    }
    return new Response(
      JSON.stringify({
        version: 1,
        exportedAt: new Date().toISOString(),
        scope: identity.scope,
        collections,
        artifactBlobs,
        excludedSecurityState: [
          "control_request_nonces",
          "control_triggers.secret_hash",
          "control_connection_oauth_states",
          "control_connection_capabilities",
          "control_connections.vault_object_id",
          "WorkOS Vault credential objects",
        ],
        unsupportedState: [
          "Durable Object chat messages; use the asynchronous data-export API for complete exports.",
        ],
        replacement: "/workbench/data-exports",
      }),
      {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": `attachment; filename="assistant-mk1-${identity.scope.workspaceId}-export.json"`,
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
        },
      },
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "export_failed";
    return json(
      { ok: false, code, error: "Workspace export could not include every retained object." },
      { status: code.startsWith("collection_too_large:") ? 409 : 503 },
    );
  }
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
