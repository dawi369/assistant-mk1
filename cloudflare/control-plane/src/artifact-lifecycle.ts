import { isRecord, json } from "./http";
import { selectMembership } from "./authz-store";
import { requireAdminMembership } from "./membership-policy";
import {
  createId,
  toJson,
  type AgentIdentity,
  type ControlArtifactRow,
  type ControlRetentionPolicyRow,
  type Env,
} from "./types";

const maximumArtifactBytes = 5 * 1024 * 1024;
const maximumArtifactBase64Length = Math.ceil(maximumArtifactBytes / 3) * 4;
const maximumArtifactDataBytes = 32 * 1024;
const maximumWorkspaceArtifactBytes = 100 * 1024 * 1024;
const maximumWorkspaceArtifactCount = 1_000;
const maximumSweepBatch = 50;
const defaultRetentionPolicy = {
  artifactRetentionDays: 90,
  operationalEventRetentionDays: 30,
  runtimeTraceRetentionDays: 14,
} as const;

type StoredArtifactRow = Pick<
  ControlArtifactRow,
  | "id"
  | "user_id"
  | "workspace_id"
  | "storage_provider"
  | "storage_key"
  | "expires_at"
  | "deleted_at"
>;

const bytesToHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const sha256Hex = async (value: Uint8Array) =>
  bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(value).buffer)));

const artifactStorageKey = (identity: AgentIdentity, artifactId: string) =>
  [
    "tenants",
    encodeURIComponent(identity.scope.userId),
    encodeURIComponent(identity.scope.workspaceId),
    "artifacts",
    encodeURIComponent(artifactId),
  ].join("/");

const decodeBase64 = (value: string): Uint8Array | null => {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
};

const mimeTypePattern = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i;

export const createArtifactBlob = async (
  env: Env,
  identity: AgentIdentity,
  input: {
    kind: string;
    title?: string;
    mimeType: string;
    contentBase64: string;
    retentionClass?: "standard" | "permanent";
    data?: Record<string, unknown>;
  },
) => {
  if (!env.ARTIFACTS) {
    return json({ ok: false, error: "Artifact blob storage is not configured." }, { status: 503 });
  }
  if (input.contentBase64.length > maximumArtifactBase64Length) {
    return json({ ok: false, error: "Artifact content exceeds the 5 MiB limit." }, { status: 413 });
  }
  const bytes = decodeBase64(input.contentBase64);
  if (!bytes) return json({ ok: false, error: "contentBase64 is invalid." }, { status: 400 });
  if (bytes.byteLength === 0 || bytes.byteLength > maximumArtifactBytes) {
    return json(
      { ok: false, error: `Artifact content must be between 1 and ${maximumArtifactBytes} bytes.` },
      { status: 413 },
    );
  }

  const artifactId = createId("cf-artifact");
  const storageKey = artifactStorageKey(identity, artifactId);
  const contentSha256 = await sha256Hex(bytes);
  const timestamp = new Date().toISOString();
  const dataJson = toJson(input.data ?? {});
  if (new TextEncoder().encode(dataJson).byteLength > maximumArtifactDataBytes) {
    return json(
      { ok: false, error: "Artifact metadata exceeds the 32 KiB limit." },
      { status: 413 },
    );
  }
  await env.ARTIFACTS.put(storageKey, bytes, {
    httpMetadata: { contentType: input.mimeType },
    customMetadata: {
      artifactId,
      userId: identity.scope.userId,
      workspaceId: identity.scope.workspaceId,
      contentSha256,
    },
  });

  try {
    const result = await env.DB.prepare(
      `INSERT INTO control_artifacts (
         id, user_id, workspace_id, kind, uri, title, mime_type, size_bytes,
         storage_provider, storage_key, content_sha256, retention_class, data_json, created_at
       )
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'r2', ?, ?, ?, ?, ?
       WHERE (
         SELECT COUNT(*) FROM control_artifacts
         WHERE user_id = ? AND workspace_id = ? AND storage_provider = 'r2' AND deleted_at IS NULL
       ) < ?
       AND (
         SELECT COALESCE(SUM(size_bytes), 0) FROM control_artifacts
         WHERE user_id = ? AND workspace_id = ? AND storage_provider = 'r2' AND deleted_at IS NULL
       ) + ? <= ?`,
    )
      .bind(
        artifactId,
        identity.scope.userId,
        identity.scope.workspaceId,
        input.kind,
        `artifact://${artifactId}`,
        input.title ?? null,
        input.mimeType,
        bytes.byteLength,
        storageKey,
        contentSha256,
        input.retentionClass ?? "standard",
        dataJson,
        timestamp,
        identity.scope.userId,
        identity.scope.workspaceId,
        maximumWorkspaceArtifactCount,
        identity.scope.userId,
        identity.scope.workspaceId,
        bytes.byteLength,
        maximumWorkspaceArtifactBytes,
      )
      .run();
    if (((result as { meta?: { changes?: number } }).meta?.changes ?? 0) < 1) {
      await env.ARTIFACTS.delete(storageKey).catch(() => undefined);
      return json(
        { ok: false, error: "Workspace artifact storage quota is exhausted." },
        { status: 409 },
      );
    }
  } catch (error) {
    await env.ARTIFACTS.delete(storageKey).catch(() => undefined);
    throw error;
  }

  return json(
    {
      ok: true,
      artifact: {
        id: artifactId,
        kind: input.kind,
        uri: `artifact://${artifactId}`,
        title: input.title,
        mimeType: input.mimeType,
        sizeBytes: bytes.byteLength,
        contentSha256,
        retentionClass: input.retentionClass ?? "standard",
        createdAt: timestamp,
      },
    },
    { status: 201 },
  );
};

export const handleCreateArtifactBlob = async (
  request: Request,
  env: Env,
  identity: AgentIdentity,
) => {
  const body = await request.json().catch(() => null);
  if (
    !isRecord(body) ||
    typeof body.kind !== "string" ||
    !body.kind.trim() ||
    body.kind.trim().length > 100 ||
    typeof body.mimeType !== "string" ||
    !mimeTypePattern.test(body.mimeType.trim()) ||
    typeof body.contentBase64 !== "string" ||
    (body.title !== undefined &&
      (typeof body.title !== "string" || body.title.trim().length > 200)) ||
    (body.data !== undefined && !isRecord(body.data)) ||
    (body.retentionClass !== undefined && body.retentionClass !== "standard")
  ) {
    return json({ ok: false, error: "Invalid artifact payload." }, { status: 400 });
  }
  return createArtifactBlob(env, identity, {
    kind: body.kind.trim(),
    title: body.title,
    mimeType: body.mimeType.trim(),
    contentBase64: body.contentBase64,
    retentionClass: body.retentionClass,
    data: body.data,
  });
};

export const handleGetArtifactBlob = async (
  env: Env,
  identity: AgentIdentity,
  artifactId: string,
) => {
  const row = await env.DB.prepare(
    `SELECT id, user_id, workspace_id, storage_provider, storage_key, expires_at, deleted_at
     FROM control_artifacts
     WHERE id = ? AND user_id = ? AND workspace_id = ? AND deleted_at IS NULL`,
  )
    .bind(artifactId, identity.scope.userId, identity.scope.workspaceId)
    .first<StoredArtifactRow>();
  if (!row) return json({ ok: false, error: "Artifact not found." }, { status: 404 });
  if (row.storage_provider !== "r2" || !row.storage_key || !env.ARTIFACTS) {
    return json(
      { ok: false, error: "Artifact content is not locally available." },
      { status: 404 },
    );
  }
  const object = await env.ARTIFACTS.get(row.storage_key);
  if (!object)
    return json({ ok: false, error: "Artifact content is unavailable." }, { status: 410 });
  return new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
};

export const sweepExpiredArtifacts = async (
  env: Env,
  input: { now?: Date; limit?: number } = {},
) => {
  const timestamp = (input.now ?? new Date()).toISOString();
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? maximumSweepBatch), 1), 100);
  const rows = await env.DB.prepare(
    `SELECT id, user_id, workspace_id, storage_provider, storage_key, expires_at, deleted_at
     FROM control_artifacts
     WHERE deleted_at IS NULL AND expires_at IS NOT NULL AND expires_at <= ?
     ORDER BY expires_at ASC, created_at ASC
     LIMIT ?`,
  )
    .bind(timestamp, limit)
    .all<StoredArtifactRow>();

  let deleted = 0;
  let failed = 0;
  for (const row of rows.results) {
    try {
      if (row.storage_provider === "r2" && row.storage_key) {
        if (!env.ARTIFACTS) throw new Error("Artifact R2 binding is unavailable.");
        await env.ARTIFACTS.delete(row.storage_key);
      }
      const result = await env.DB.prepare(
        `UPDATE control_artifacts
         SET uri = 'artifact://deleted', storage_key = NULL, deleted_at = ?
         WHERE id = ? AND user_id = ? AND workspace_id = ?
           AND deleted_at IS NULL AND expires_at IS NOT NULL AND expires_at <= ?`,
      )
        .bind(timestamp, row.id, row.user_id, row.workspace_id, timestamp)
        .run();
      const changes = (result as { meta?: { changes?: number } }).meta?.changes ?? 0;
      if (changes > 0) deleted += 1;
    } catch (error) {
      failed += 1;
      console.error("Artifact retention sweep failed", {
        artifactId: row.id,
        storageProvider: row.storage_provider,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { inspected: rows.results.length, deleted, failed };
};

export const sweepExpiredOperationalData = async (
  env: Env,
  input: { now?: Date; limit?: number } = {},
) => {
  const timestamp = (input.now ?? new Date()).toISOString();
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? maximumSweepBatch), 1), 100);
  const results = await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM control_plane_events
       WHERE rowid IN (
         SELECT events.rowid
         FROM control_plane_events events
         LEFT JOIN control_retention_policies policies
           ON policies.user_id = events.user_id AND policies.workspace_id = events.workspace_id
         WHERE events.created_at <= strftime(
           '%Y-%m-%dT%H:%M:%fZ', ?,
           '-' || COALESCE(policies.operational_event_retention_days, 30) || ' days'
         )
         ORDER BY events.created_at ASC
         LIMIT ?
       )`,
    ).bind(timestamp, limit),
    env.DB.prepare(
      `DELETE FROM runtime_spans
       WHERE trace_id IN (
         SELECT traces.trace_id
         FROM runtime_traces traces
         LEFT JOIN control_retention_policies policies
           ON policies.user_id = traces.user_id AND policies.workspace_id = traces.workspace_id
         WHERE traces.created_at <= strftime(
           '%Y-%m-%dT%H:%M:%fZ', ?,
           '-' || COALESCE(policies.runtime_trace_retention_days, 14) || ' days'
         )
         ORDER BY traces.created_at ASC
         LIMIT ?
       )`,
    ).bind(timestamp, limit),
    env.DB.prepare(
      `DELETE FROM runtime_traces
       WHERE trace_id IN (
         SELECT traces.trace_id
         FROM runtime_traces traces
         LEFT JOIN control_retention_policies policies
           ON policies.user_id = traces.user_id AND policies.workspace_id = traces.workspace_id
         WHERE traces.created_at <= strftime(
           '%Y-%m-%dT%H:%M:%fZ', ?,
           '-' || COALESCE(policies.runtime_trace_retention_days, 14) || ' days'
         )
         ORDER BY traces.created_at ASC
         LIMIT ?
       )`,
    ).bind(timestamp, limit),
  ]);
  return {
    eventsDeleted: results[0]?.meta?.changes ?? 0,
    spansDeleted: results[1]?.meta?.changes ?? 0,
    tracesDeleted: results[2]?.meta?.changes ?? 0,
  };
};

const toRetentionPolicy = (row: ControlRetentionPolicyRow | null) => ({
  ...(row
    ? {
        artifactRetentionDays: row.artifact_retention_days,
        operationalEventRetentionDays: row.operational_event_retention_days,
        runtimeTraceRetentionDays: row.runtime_trace_retention_days,
      }
    : defaultRetentionPolicy),
  source: row ? ("workspace" as const) : ("default" as const),
  updatedAt: row?.updated_at,
});

const selectRetentionPolicy = (env: Env, identity: AgentIdentity) =>
  env.DB.prepare(
    `SELECT user_id, workspace_id, artifact_retention_days,
            operational_event_retention_days, runtime_trace_retention_days,
            created_at, updated_at
     FROM control_retention_policies
     WHERE user_id = ? AND workspace_id = ?`,
  )
    .bind(identity.scope.userId, identity.scope.workspaceId)
    .first<ControlRetentionPolicyRow>();

export const handleGetRetentionPolicy = async (env: Env, identity: AgentIdentity) =>
  json({ ok: true, policy: toRetentionPolicy(await selectRetentionPolicy(env, identity)) });

const readRetentionDays = (value: unknown) =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 3650
    ? value
    : null;

export const handleUpdateRetentionPolicy = async (
  request: Request,
  env: Env,
  identity: AgentIdentity,
) => {
  const membership = await selectMembership(env, identity.scope.userId, identity.scope.workspaceId);
  const membershipError = requireAdminMembership(membership);
  if (membershipError) return membershipError;

  const body = await request.json().catch(() => null);
  if (!isRecord(body)) {
    return json({ ok: false, error: "Invalid retention policy payload." }, { status: 400 });
  }
  const artifactRetentionDays = readRetentionDays(body.artifactRetentionDays);
  const operationalEventRetentionDays = readRetentionDays(body.operationalEventRetentionDays);
  const runtimeTraceRetentionDays = readRetentionDays(body.runtimeTraceRetentionDays);
  if (!artifactRetentionDays || !operationalEventRetentionDays || !runtimeTraceRetentionDays) {
    return json(
      { ok: false, error: "Retention periods must be whole days between 1 and 3650." },
      { status: 400 },
    );
  }

  const timestamp = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO control_retention_policies (
         user_id, workspace_id, artifact_retention_days, operational_event_retention_days,
         runtime_trace_retention_days, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, workspace_id) DO UPDATE SET
         artifact_retention_days = excluded.artifact_retention_days,
         operational_event_retention_days = excluded.operational_event_retention_days,
         runtime_trace_retention_days = excluded.runtime_trace_retention_days,
         updated_at = excluded.updated_at`,
    ).bind(
      identity.scope.userId,
      identity.scope.workspaceId,
      artifactRetentionDays,
      operationalEventRetentionDays,
      runtimeTraceRetentionDays,
      timestamp,
      timestamp,
    ),
    env.DB.prepare(
      `UPDATE control_artifacts
       SET expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+' || ? || ' days')
       WHERE user_id = ? AND workspace_id = ? AND retention_class = 'standard'
         AND deleted_at IS NULL`,
    ).bind(artifactRetentionDays, identity.scope.userId, identity.scope.workspaceId),
    env.DB.prepare(
      `INSERT INTO control_audit_events (
         id, user_id, workspace_id, action, summary, target_type, target_id, data_json, created_at
       ) VALUES (?, ?, ?, 'retention.policy.updated', 'Workspace retention policy updated.',
         'workspace', ?, ?, ?)`,
    ).bind(
      createId("cf-audit"),
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.scope.workspaceId,
      toJson({ artifactRetentionDays, operationalEventRetentionDays, runtimeTraceRetentionDays }),
      timestamp,
    ),
  ]);

  return json({
    ok: true,
    policy: {
      artifactRetentionDays,
      operationalEventRetentionDays,
      runtimeTraceRetentionDays,
      source: "workspace",
      updatedAt: timestamp,
    },
  });
};
