import { selectMembership } from "./authz-store";
import { json } from "./http";
import { requireAdminMembership } from "./membership-policy";
import { createId, toJson, type AgentIdentity, type Env } from "./types";

const maximumRowsPerCollection = 1_000;
const maximumExportBlobBytes = 10 * 1024 * 1024;

type ExportCollection = {
  name: string;
  query: string;
  bindings: (identity: AgentIdentity) => unknown[];
};

const tenantCollection = (name: string, select = "*"): ExportCollection => ({
  name,
  query: `SELECT ${select} FROM ${name} WHERE user_id = ? AND workspace_id = ? LIMIT ?`,
  bindings: (identity) => [identity.scope.userId, identity.scope.workspaceId],
});

const exportCollections: ExportCollection[] = [
  {
    name: "users",
    query: "SELECT * FROM users WHERE id = ? LIMIT ?",
    bindings: (identity) => [identity.scope.userId],
  },
  {
    name: "workspaces",
    query: "SELECT * FROM workspaces WHERE id = ? LIMIT ?",
    bindings: (identity) => [identity.scope.workspaceId],
  },
  tenantCollection("active_workspace_preferences"),
  tenantCollection("memberships"),
  {
    name: "agents",
    query: "SELECT * FROM agents WHERE workspace_id = ? LIMIT ?",
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
];

const requireLifecycleAdmin = async (env: Env, identity: AgentIdentity) => {
  const membership = await selectMembership(env, identity.scope.userId, identity.scope.workspaceId);
  return requireAdminMembership(membership);
};

const loadCollections = async (env: Env, identity: AgentIdentity) => {
  const collections: Record<string, Record<string, unknown>[]> = {};
  for (const collection of exportCollections) {
    const result = await env.DB.prepare(collection.query)
      .bind(...collection.bindings(identity), maximumRowsPerCollection + 1)
      .all<Record<string, unknown>>();
    if (result.results.length > maximumRowsPerCollection) {
      throw new Error(`collection_too_large:${collection.name}`);
    }
    collections[collection.name] = result.results;
  }
  return collections;
};

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
};

const bytesToHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const sha256Hex = async (bytes: Uint8Array) =>
  bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer)));

const loadArtifactBlobs = async (
  env: Env,
  artifacts: Record<string, unknown>[],
): Promise<Record<string, unknown>[]> => {
  const stored = artifacts.filter(
    (artifact) =>
      artifact.storage_provider === "r2" &&
      typeof artifact.storage_key === "string" &&
      artifact.deleted_at === null,
  );
  if (stored.length > 0 && !env.ARTIFACTS) {
    throw new Error("artifact_storage_unavailable");
  }
  let totalBytes = 0;
  const blobs: Record<string, unknown>[] = [];
  for (const artifact of stored) {
    const object = await env.ARTIFACTS!.get(artifact.storage_key as string);
    if (!object) throw new Error(`artifact_content_missing:${String(artifact.id)}`);
    const content = new Uint8Array(await object.arrayBuffer());
    const expectedSha256 = artifact.content_sha256;
    if (typeof expectedSha256 !== "string" || (await sha256Hex(content)) !== expectedSha256) {
      throw new Error(`artifact_checksum_mismatch:${String(artifact.id)}`);
    }
    totalBytes += content.byteLength;
    if (totalBytes > maximumExportBlobBytes) throw new Error("artifact_export_too_large");
    blobs.push({
      artifactId: artifact.id,
      storageKey: artifact.storage_key,
      contentSha256: artifact.content_sha256,
      mimeType: artifact.mime_type,
      sizeBytes: content.byteLength,
      contentBase64: bytesToBase64(content),
    });
  }
  return blobs;
};

const exportErrorResponse = (error: unknown) => {
  const code = error instanceof Error ? error.message : "export_failed";
  if (code.startsWith("collection_too_large:")) {
    return json(
      { ok: false, error: "Workspace export exceeds the bounded preview limit.", code },
      { status: 409 },
    );
  }
  if (
    code === "artifact_storage_unavailable" ||
    code === "artifact_export_too_large" ||
    code.startsWith("artifact_content_missing:") ||
    code.startsWith("artifact_checksum_mismatch:")
  ) {
    return json(
      { ok: false, error: "Workspace export cannot include every retained artifact.", code },
      { status: 503 },
    );
  }
  throw error;
};

export const handleExportWorkspaceData = async (env: Env, identity: AgentIdentity) => {
  const adminError = await requireLifecycleAdmin(env, identity);
  if (adminError) return adminError;
  try {
    const collections = await loadCollections(env, identity);
    const artifactBlobs = await loadArtifactBlobs(env, collections.control_artifacts ?? []);
    const exportedAt = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO control_audit_events (
         id, user_id, workspace_id, action, summary, target_type, target_id, data_json, created_at
       ) VALUES (?, ?, ?, 'workspace.data.exported', 'Workspace data export created.',
         'workspace', ?, ?, ?)`,
    )
      .bind(
        createId("cf-audit"),
        identity.scope.userId,
        identity.scope.workspaceId,
        identity.scope.workspaceId,
        toJson({
          collectionCounts: Object.fromEntries(
            Object.entries(collections).map(([name, rows]) => [name, rows.length]),
          ),
          artifactBlobCount: artifactBlobs.length,
        }),
        exportedAt,
      )
      .run();
    return new Response(
      JSON.stringify({
        version: 1,
        exportedAt,
        scope: identity.scope,
        collections,
        artifactBlobs,
        excludedSecurityState: ["control_request_nonces", "control_triggers.secret_hash"],
        unsupportedState: ["Durable Object chat message bodies and hot coordination state"],
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
    return exportErrorResponse(error);
  }
};

export const handleWorkspaceDeletionPlan = async (env: Env, identity: AgentIdentity) => {
  const adminError = await requireLifecycleAdmin(env, identity);
  if (adminError) return adminError;
  try {
    const collections = await loadCollections(env, identity);
    const counts = Object.fromEntries(
      Object.entries(collections).map(([name, rows]) => [name, rows.length]),
    );
    const r2Objects = (collections.control_artifacts ?? []).filter(
      (artifact) => artifact.storage_provider === "r2" && artifact.deleted_at === null,
    ).length;
    return json({
      ok: true,
      plan: {
        scope: identity.scope,
        d1RowsByCollection: counts,
        r2Objects,
        executable: false,
        blockers: [
          "Durable Object chat message deletion is not implemented.",
          "Two-phase destructive confirmation and resumable deletion jobs are not implemented.",
        ],
      },
    });
  } catch (error) {
    return exportErrorResponse(error);
  }
};
