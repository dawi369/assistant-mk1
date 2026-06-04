import { parseDataJson } from "./http";
import { createId, toJson, type AgentIdentity, type ControlPlaneEventRow, type Env } from "./types";

const defaultLimit = 50;
const maxLimit = 100;

const readLimit = (url: URL) => {
  const requested = Number(url.searchParams.get("limit") ?? defaultLimit);
  if (!Number.isFinite(requested)) return defaultLimit;
  return Math.min(Math.max(Math.trunc(requested), 1), maxLimit);
};

export const appendControlPlaneEvent = async (
  env: Env,
  identity: AgentIdentity,
  input: {
    type: string;
    summary: string;
    targetType?: string;
    targetId?: string;
    data?: Record<string, unknown>;
  },
) => {
  const timestamp = new Date().toISOString();
  const eventId = createId("cf-event");
  await env.DB.prepare(
    `INSERT INTO control_plane_events (
       id, user_id, workspace_id, agent_id, type, summary, target_type, target_id,
       data_json, created_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      eventId,
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.agentId,
      input.type,
      input.summary,
      input.targetType ?? null,
      input.targetId ?? null,
      toJson(input.data ?? {}),
      timestamp,
    )
    .run();
  return eventId;
};

const listLatestEvents = async (env: Env, identity: AgentIdentity, limit: number) => {
  const events = await env.DB.prepare(
    `SELECT id, user_id, workspace_id, agent_id, type, summary, target_type, target_id,
            data_json, created_at
     FROM control_plane_events
     WHERE user_id = ? AND workspace_id = ?
     ORDER BY rowid DESC
     LIMIT ?`,
  )
    .bind(identity.scope.userId, identity.scope.workspaceId, limit)
    .all<ControlPlaneEventRow>();
  return events.results;
};

const listEventsAfter = async (
  env: Env,
  identity: AgentIdentity,
  afterEventId: string,
  limit: number,
) => {
  const cursor = await env.DB.prepare(
    `SELECT rowid AS cursor
     FROM control_plane_events
     WHERE user_id = ? AND workspace_id = ? AND id = ?
     LIMIT 1`,
  )
    .bind(identity.scope.userId, identity.scope.workspaceId, afterEventId)
    .first<{ cursor: number }>();

  if (!cursor) return [];

  const events = await env.DB.prepare(
    `SELECT id, user_id, workspace_id, agent_id, type, summary, target_type, target_id,
            data_json, created_at
     FROM control_plane_events
     WHERE user_id = ? AND workspace_id = ? AND rowid > ?
     ORDER BY rowid ASC
     LIMIT ?`,
  )
    .bind(identity.scope.userId, identity.scope.workspaceId, cursor.cursor, limit)
    .all<ControlPlaneEventRow>();
  return events.results;
};

export const toControlPlaneEventSnapshot = (row: ControlPlaneEventRow) => ({
  id: row.id,
  scope: {
    userId: row.user_id,
    workspaceId: row.workspace_id,
  },
  agentId: row.agent_id,
  type: row.type,
  summary: row.summary,
  targetType: row.target_type ?? undefined,
  targetId: row.target_id ?? undefined,
  data: parseDataJson(row.data_json),
  createdAt: row.created_at,
});

export const handleLatestControlPlaneEvents = async (
  env: Env,
  identity: AgentIdentity,
  url: URL,
) => {
  const events = await listLatestEvents(env, identity, readLimit(url));
  return {
    ok: true,
    events: events.map(toControlPlaneEventSnapshot),
  };
};

export const handleControlPlaneEvents = async (env: Env, identity: AgentIdentity, url: URL) => {
  const limit = readLimit(url);
  const after = url.searchParams.get("after")?.trim();
  const events = after
    ? await listEventsAfter(env, identity, after, limit)
    : await listLatestEvents(env, identity, limit);

  return {
    ok: true,
    events: events.map(toControlPlaneEventSnapshot),
  };
};
