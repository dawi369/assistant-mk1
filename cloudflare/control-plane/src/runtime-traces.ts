import { json, parseDataJson } from "./http";
import {
  createId,
  toJson,
  type AgentIdentity,
  type Env,
  type RuntimeSpanRow,
  type RuntimeTraceRow,
  type TenantScope,
} from "./types";

export type RuntimeTraceKind =
  | "chat.thread.create"
  | "chat.run.stream"
  | "tool.url.inspect"
  | "diagnostic.demo.inspect";

export type RuntimeTraceStatus = "running" | "completed" | "failed" | "blocked";

export type RuntimeSpanLayer =
  | "browser"
  | "vercel"
  | "cloudflare"
  | "d1"
  | "provider"
  | "executor"
  | "tool";

export type RuntimeSpanStatus = "running" | "completed" | "failed" | "blocked";

export type RuntimeTraceContext = {
  traceId: string;
  kind: RuntimeTraceKind;
  rootName: string;
  startedAtMs: number;
};

export type IncomingRuntimeTrace = {
  traceId: string;
  authzStartedAtMs: number;
  authzEndedAtMs: number;
  vercelStartedAtMs?: number | null;
  vercelDurationMs?: number | null;
  threadOwnershipStartedAtMs?: number | null;
  threadOwnershipEndedAtMs?: number | null;
};

const traceIdHeader = "x-assistant-mk1-trace-id";
const vercelStartedAtHeader = "x-assistant-mk1-vercel-started-at";
const vercelDurationHeader = "x-assistant-mk1-vercel-duration-ms";

export const runtimeTraceHeaders = {
  traceId: traceIdHeader,
  vercelStartedAt: vercelStartedAtHeader,
  vercelDurationMs: vercelDurationHeader,
};

const toIso = (valueMs: number) => new Date(valueMs).toISOString();

const duration = (startedAtMs: number, endedAtMs: number) =>
  Math.max(0, Math.round(endedAtMs - startedAtMs));

const readNumberHeader = (request: Request, name: string) => {
  const raw = request.headers.get(name);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

export const getTraceId = (request: Request) =>
  request.headers.get(traceIdHeader)?.trim() || createId("cf-trace");

export const readVercelTimingHeaders = (request: Request) => ({
  startedAtMs: readNumberHeader(request, vercelStartedAtHeader),
  durationMs: readNumberHeader(request, vercelDurationHeader),
});

const computeBottleneckSpanId = (spans: RuntimeSpanRow[]) => {
  let bottleneck: RuntimeSpanRow | null = null;
  for (const span of spans) {
    if (typeof span.duration_ms !== "number") continue;
    if (!bottleneck || (bottleneck.duration_ms ?? 0) < span.duration_ms) bottleneck = span;
  }
  return bottleneck?.span_id ?? null;
};

const toTraceSummary = (row: RuntimeTraceRow) => ({
  traceId: row.trace_id,
  scope: {
    userId: row.user_id,
    workspaceId: row.workspace_id,
  },
  agentId: row.agent_id,
  kind: row.kind,
  status: row.status,
  rootName: row.root_name,
  summary: row.summary ?? undefined,
  bottleneckSpanId: row.bottleneck_span_id ?? undefined,
  data: parseDataJson(row.data_json),
  startedAt: row.started_at,
  endedAt: row.ended_at ?? undefined,
  durationMs: row.duration_ms ?? undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toSpanSummary = (row: RuntimeSpanRow) => ({
  spanId: row.span_id,
  traceId: row.trace_id,
  parentSpanId: row.parent_span_id ?? undefined,
  scope: {
    userId: row.user_id,
    workspaceId: row.workspace_id,
  },
  agentId: row.agent_id,
  name: row.name,
  layer: row.layer,
  status: row.status,
  data: parseDataJson(row.data_json),
  startedAt: row.started_at,
  endedAt: row.ended_at ?? undefined,
  durationMs: row.duration_ms ?? undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const readTraceRow = (env: Env, scope: TenantScope, traceId: string) =>
  env.DB.prepare(
    `SELECT trace_id, user_id, workspace_id, agent_id, kind, status, root_name, summary,
            bottleneck_span_id, data_json, started_at, ended_at, duration_ms, created_at,
            updated_at
     FROM runtime_traces
     WHERE user_id = ? AND workspace_id = ? AND trace_id = ?
     LIMIT 1`,
  )
    .bind(scope.userId, scope.workspaceId, traceId)
    .first<RuntimeTraceRow>();

export const listRuntimeTraceRows = async (env: Env, scope: TenantScope, limit = 10) => {
  const rows = await env.DB.prepare(
    `SELECT trace_id, user_id, workspace_id, agent_id, kind, status, root_name, summary,
            bottleneck_span_id, data_json, started_at, ended_at, duration_ms, created_at,
            updated_at
     FROM runtime_traces
     WHERE user_id = ? AND workspace_id = ?
     ORDER BY updated_at DESC, started_at DESC
     LIMIT ?`,
  )
    .bind(scope.userId, scope.workspaceId, limit)
    .all<RuntimeTraceRow>();
  return rows.results;
};

export const listRuntimeSpans = async (env: Env, scope: TenantScope, traceId: string) => {
  const rows = await env.DB.prepare(
    `SELECT span_id, trace_id, parent_span_id, user_id, workspace_id, agent_id, name, layer,
            status, data_json, started_at, ended_at, duration_ms, created_at, updated_at
     FROM runtime_spans
     WHERE user_id = ? AND workspace_id = ? AND trace_id = ?
     ORDER BY started_at ASC, created_at ASC`,
  )
    .bind(scope.userId, scope.workspaceId, traceId)
    .all<RuntimeSpanRow>();
  return rows.results;
};

export const getRuntimeTraceSnapshot = async (env: Env, scope: TenantScope, traceId: string) => {
  const trace = await readTraceRow(env, scope, traceId);
  if (!trace) return null;
  const spans = await listRuntimeSpans(env, scope, traceId);
  return {
    trace: toTraceSummary(trace),
    spans: spans.map(toSpanSummary),
  };
};

export const getLatestRuntimeTraceSnapshot = async (env: Env, scope: TenantScope) => {
  const [latest] = await listRuntimeTraceRows(env, scope, 1);
  return latest ? getRuntimeTraceSnapshot(env, scope, latest.trace_id) : null;
};

export const listRuntimeTraceSummaries = async (env: Env, scope: TenantScope, limit = 10) => {
  const rows = await listRuntimeTraceRows(env, scope, limit);
  return rows.map(toTraceSummary);
};

export const startTrace = async (
  env: Env,
  identity: AgentIdentity,
  input: {
    traceId?: string;
    kind: RuntimeTraceKind;
    rootName: string;
    summary?: string;
    data?: Record<string, unknown>;
    startedAtMs?: number;
  },
): Promise<RuntimeTraceContext> => {
  const startedAtMs = input.startedAtMs ?? Date.now();
  const timestamp = toIso(startedAtMs);
  const traceId = input.traceId || createId("cf-trace");
  await env.DB.prepare(
    `INSERT INTO runtime_traces (
       trace_id, user_id, workspace_id, agent_id, kind, status, root_name, summary,
       data_json, started_at, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(trace_id) DO UPDATE SET
       updated_at = excluded.updated_at`,
  )
    .bind(
      traceId,
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.agentId,
      input.kind,
      "running",
      input.rootName,
      input.summary ?? null,
      toJson(input.data ?? {}),
      timestamp,
      timestamp,
      timestamp,
    )
    .run();
  return { traceId, kind: input.kind, rootName: input.rootName, startedAtMs };
};

export const recordSpan = async (
  env: Env,
  identity: AgentIdentity,
  input: {
    traceId: string;
    spanId?: string;
    parentSpanId?: string;
    name: string;
    layer: RuntimeSpanLayer;
    status?: RuntimeSpanStatus;
    data?: Record<string, unknown>;
    startedAtMs: number;
    endedAtMs?: number;
  },
) => {
  const endedAtMs = input.endedAtMs ?? Date.now();
  const spanId = input.spanId ?? createId("cf-span");
  const timestamp = toIso(endedAtMs);
  await env.DB.prepare(
    `INSERT INTO runtime_spans (
       span_id, trace_id, parent_span_id, user_id, workspace_id, agent_id, name, layer, status,
       data_json, started_at, ended_at, duration_ms, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(span_id) DO UPDATE SET
       status = excluded.status,
       data_json = excluded.data_json,
       ended_at = excluded.ended_at,
       duration_ms = excluded.duration_ms,
       updated_at = excluded.updated_at`,
  )
    .bind(
      spanId,
      input.traceId,
      input.parentSpanId ?? null,
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.agentId,
      input.name,
      input.layer,
      input.status ?? "completed",
      toJson(input.data ?? {}),
      toIso(input.startedAtMs),
      toIso(endedAtMs),
      duration(input.startedAtMs, endedAtMs),
      timestamp,
      timestamp,
    )
    .run();
  return spanId;
};

export const recordIncomingRequestSpans = async (
  env: Env,
  identity: AgentIdentity,
  trace: RuntimeTraceContext,
  incoming?: IncomingRuntimeTrace,
) => {
  if (!incoming) return;

  if (incoming.vercelStartedAtMs && incoming.vercelDurationMs) {
    await recordSpan(env, identity, {
      traceId: trace.traceId,
      name: "Vercel proxy",
      layer: "vercel",
      startedAtMs: incoming.vercelStartedAtMs,
      endedAtMs: incoming.vercelStartedAtMs + incoming.vercelDurationMs,
      data: { source: "x-assistant-mk1-vercel-duration-ms" },
    });
  }

  await recordSpan(env, identity, {
    traceId: trace.traceId,
    name: "Cloudflare authz",
    layer: "cloudflare",
    startedAtMs: incoming.authzStartedAtMs,
    endedAtMs: incoming.authzEndedAtMs,
    data: { source: "resolveAgentIdentity" },
  });

  if (incoming.threadOwnershipStartedAtMs && incoming.threadOwnershipEndedAtMs) {
    await recordSpan(env, identity, {
      traceId: trace.traceId,
      name: "Thread ownership check",
      layer: "d1",
      startedAtMs: incoming.threadOwnershipStartedAtMs,
      endedAtMs: incoming.threadOwnershipEndedAtMs,
      data: { source: "getOwnedChatThread" },
    });
  }
};

export const finishTrace = async (
  env: Env,
  identity: AgentIdentity,
  trace: RuntimeTraceContext,
  input: {
    status: RuntimeTraceStatus;
    summary?: string;
    data?: Record<string, unknown>;
    endedAtMs?: number;
  },
) => {
  const endedAtMs = input.endedAtMs ?? Date.now();
  const spans = await listRuntimeSpans(env, identity.scope, trace.traceId);
  const bottleneckSpanId = computeBottleneckSpanId(spans);
  await env.DB.prepare(
    `UPDATE runtime_traces
     SET status = ?, summary = ?, bottleneck_span_id = ?, data_json = ?, ended_at = ?,
         duration_ms = ?, updated_at = ?
     WHERE user_id = ? AND workspace_id = ? AND trace_id = ?`,
  )
    .bind(
      input.status,
      input.summary ?? null,
      bottleneckSpanId,
      toJson(input.data ?? {}),
      toIso(endedAtMs),
      duration(trace.startedAtMs, endedAtMs),
      toIso(endedAtMs),
      identity.scope.userId,
      identity.scope.workspaceId,
      trace.traceId,
    )
    .run();
};

export const handleLatestRuntimeTraces = async (env: Env, identity: AgentIdentity, url: URL) => {
  const requested = Number(url.searchParams.get("limit") ?? 10);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), 25) : 10;
  const recentTraces = await listRuntimeTraceSummaries(env, identity.scope, limit);
  const latestTrace = recentTraces[0]
    ? await getRuntimeTraceSnapshot(env, identity.scope, recentTraces[0].traceId)
    : null;
  return json({
    ok: true,
    recentTraces,
    latestTrace: latestTrace?.trace ?? null,
    traceWaterfall: latestTrace?.spans ?? [],
  });
};

export const handleGetRuntimeTrace = async (env: Env, identity: AgentIdentity, traceId: string) => {
  const snapshot = await getRuntimeTraceSnapshot(env, identity.scope, traceId);
  if (!snapshot) return json({ ok: false, error: "Trace not found" }, { status: 404 });
  return json({ ok: true, trace: snapshot.trace, spans: snapshot.spans });
};
