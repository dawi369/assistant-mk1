import { selectMembership } from "./authz-store";
import { json, parseDataJson } from "./http";
import { requireActiveMembership } from "./membership-policy";
import { type AgentIdentity, type ControlManagedStateRow, type Env, toJson } from "./types";

const identifierPattern = /^[a-z][a-z0-9._-]{0,79}$/;
const defaultLimit = 50;
const maximumLimit = 100;

export type ManagedStateWrite = {
  id: string;
  namespace: string;
  stateType: string;
  stateKey: string;
  status: string;
  summary?: string;
  artifactRefs?: string[];
  data?: Record<string, unknown>;
  expectedVersion?: number;
};

export const readManagedStateVersion = async (
  env: Env,
  identity: AgentIdentity,
  input: { namespace: string; stateType: string; stateKey: string },
) => {
  validateIdentifier("namespace", input.namespace);
  validateIdentifier("stateType", input.stateType);
  validateIdentifier("stateKey", input.stateKey);
  const row = await env.DB.prepare(
    `SELECT version
     FROM control_managed_state
     WHERE user_id = ? AND workspace_id = ? AND agent_id = ?
       AND namespace = ? AND state_type = ? AND state_key = ?`,
  )
    .bind(
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.agentId,
      input.namespace,
      input.stateType,
      input.stateKey,
    )
    .first<{ version: number }>();
  return row?.version ?? 0;
};

const parseArtifactRefs = (value: string) => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
};

const mapManagedState = (row: ControlManagedStateRow) => ({
  id: row.id,
  agentId: row.agent_id,
  namespace: row.namespace,
  stateType: row.state_type,
  stateKey: row.state_key,
  type: row.state_type,
  name: row.state_key,
  status: row.status,
  summary: row.summary ?? undefined,
  version: row.version,
  artifactRefs: parseArtifactRefs(row.artifact_refs_json),
  data: parseDataJson(row.data_json),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const validateIdentifier = (name: string, value: string) => {
  if (!identifierPattern.test(value)) throw new Error(`${name} is invalid`);
};

export const upsertManagedState = async (
  env: Env,
  identity: AgentIdentity,
  input: ManagedStateWrite,
) => {
  validateIdentifier("namespace", input.namespace);
  validateIdentifier("stateType", input.stateType);
  validateIdentifier("stateKey", input.stateKey);
  validateIdentifier("status", input.status);
  if (!input.id.trim() || input.id.length > 160) throw new Error("id is invalid");
  if (input.summary && input.summary.length > 500) throw new Error("summary is too long");
  if (input.artifactRefs && input.artifactRefs.some((ref) => !ref || ref.length > 160)) {
    throw new Error("artifactRefs are invalid");
  }

  const now = new Date().toISOString();
  const expectedVersion = input.expectedVersion ?? 0;
  const result = await env.DB.prepare(
    `INSERT INTO control_managed_state (
       id, user_id, workspace_id, agent_id, namespace, state_type, state_key,
       status, summary, version, artifact_refs_json, data_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
     ON CONFLICT(user_id, workspace_id, agent_id, namespace, state_type, state_key)
     DO UPDATE SET
       status = excluded.status,
       summary = excluded.summary,
       version = control_managed_state.version + 1,
       artifact_refs_json = excluded.artifact_refs_json,
       data_json = excluded.data_json,
       updated_at = excluded.updated_at
     WHERE control_managed_state.version = ?`,
  )
    .bind(
      input.id,
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.agentId,
      input.namespace,
      input.stateType,
      input.stateKey,
      input.status,
      input.summary ?? null,
      toJson(input.artifactRefs ?? []),
      toJson(input.data ?? {}),
      now,
      now,
      expectedVersion,
    )
    .run();

  const changes = (result as { meta?: { changes?: number } }).meta?.changes;
  if (changes === 0) return { ok: false as const, reason: "version_conflict" as const };

  const row = await env.DB.prepare(
    `SELECT id, user_id, workspace_id, agent_id, namespace, state_type, state_key,
            status, summary, version, artifact_refs_json, data_json, created_at, updated_at
     FROM control_managed_state
     WHERE user_id = ? AND workspace_id = ? AND agent_id = ?
       AND namespace = ? AND state_type = ? AND state_key = ?`,
  )
    .bind(
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.agentId,
      input.namespace,
      input.stateType,
      input.stateKey,
    )
    .first<ControlManagedStateRow>();
  if (!row) throw new Error("Managed state write did not return a row");
  return { ok: true as const, state: mapManagedState(row) };
};

export const handleListManagedState = async (env: Env, identity: AgentIdentity, url: URL) => {
  const membership = await selectMembership(env, identity.scope.userId, identity.scope.workspaceId);
  const membershipError = requireActiveMembership(membership);
  if (membershipError) return membershipError;

  const namespace = url.searchParams.get("namespace")?.trim() ?? "";
  const stateType = url.searchParams.get("type")?.trim() ?? "";
  if (
    (namespace && !identifierPattern.test(namespace)) ||
    (stateType && !identifierPattern.test(stateType))
  ) {
    return json({ ok: false, error: "Invalid managed-state filter" }, { status: 400 });
  }
  const requestedLimit = Number(url.searchParams.get("limit") ?? defaultLimit);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(Math.trunc(requestedLimit), 1), maximumLimit)
    : defaultLimit;

  const clauses = ["user_id = ?", "workspace_id = ?", "agent_id = ?"];
  const bindings: unknown[] = [identity.scope.userId, identity.scope.workspaceId, identity.agentId];
  if (namespace) {
    clauses.push("namespace = ?");
    bindings.push(namespace);
  }
  if (stateType) {
    clauses.push("state_type = ?");
    bindings.push(stateType);
  }
  bindings.push(limit);

  const rows = await env.DB.prepare(
    `SELECT id, user_id, workspace_id, agent_id, namespace, state_type, state_key,
            status, summary, version, artifact_refs_json, data_json, created_at, updated_at
     FROM control_managed_state
     WHERE ${clauses.join(" AND ")}
     ORDER BY updated_at DESC, created_at DESC
     LIMIT ?`,
  )
    .bind(...bindings)
    .all<ControlManagedStateRow>();

  return json({ ok: true, states: rows.results.map(mapManagedState), limit });
};

export const handleGetManagedState = async (env: Env, identity: AgentIdentity, stateId: string) => {
  const membership = await selectMembership(env, identity.scope.userId, identity.scope.workspaceId);
  const membershipError = requireActiveMembership(membership);
  if (membershipError) return membershipError;

  const row = await env.DB.prepare(
    `SELECT id, user_id, workspace_id, agent_id, namespace, state_type, state_key,
            status, summary, version, artifact_refs_json, data_json, created_at, updated_at
     FROM control_managed_state
     WHERE user_id = ? AND workspace_id = ? AND agent_id = ? AND id = ?`,
  )
    .bind(identity.scope.userId, identity.scope.workspaceId, identity.agentId, stateId)
    .first<ControlManagedStateRow>();
  if (!row) return json({ ok: false, error: "Managed state not found" }, { status: 404 });
  return json({ ok: true, state: mapManagedState(row) });
};
