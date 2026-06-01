type RunStatus =
  | "queued"
  | "running"
  | "waiting"
  | "interrupted"
  | "completed"
  | "failed"
  | "cancelled";

type D1PreparedStatement = {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  run(): Promise<unknown>;
};

type D1Database = {
  prepare(query: string): D1PreparedStatement;
};

type Env = {
  DB: D1Database;
  CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN?: string;
};

type RunProbeRow = {
  user_id: string;
  workspace_id: string;
  agent_id: string;
  run_id: string;
  status: RunStatus;
  summary: string | null;
  data_json: string;
  created_at: string;
  updated_at: string;
};

const fixtureScope = {
  userId: "fixture-user",
  workspaceId: "fixture-workspace",
};

const fixtureAgentId = "fixture-agent";

const allowedStatuses = new Set<RunStatus>([
  "queued",
  "running",
  "waiting",
  "interrupted",
  "completed",
  "failed",
  "cancelled",
]);

const json = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...init?.headers,
    },
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireAuth = (request: Request, env: Env) => {
  const token = env.CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN;
  if (!token) {
    return json(
      { ok: false, error: "CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN is not configured" },
      { status: 500 },
    );
  }

  const authorization = request.headers.get("authorization");
  if (authorization !== `Bearer ${token}`) {
    return json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  return null;
};

const parseDataJson = (raw: string) => {
  try {
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const toRunProbe = (row: RunProbeRow) => ({
  scope: fixtureScope,
  agentId: row.agent_id,
  runId: row.run_id,
  status: row.status,
  summary: row.summary ?? undefined,
  data: parseDataJson(row.data_json),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const readLatestRunProbe = async (env: Env) => {
  const row = await env.DB.prepare(
    `SELECT user_id, workspace_id, agent_id, run_id, status, summary, data_json, created_at, updated_at
     FROM run_probes
     WHERE user_id = ? AND workspace_id = ?
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`,
  )
    .bind(fixtureScope.userId, fixtureScope.workspaceId)
    .first<RunProbeRow>();

  return row ? toRunProbe(row) : null;
};

const handlePostRunProbe = async (request: Request, env: Env) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "request body must be JSON" }, { status: 400 });
  }

  if (!isRecord(body)) {
    return json({ ok: false, error: "request body must be an object" }, { status: 400 });
  }

  const runId = body.runId;
  const status = body.status;
  if (typeof runId !== "string" || runId.length === 0) {
    return json({ ok: false, error: "runId is required" }, { status: 400 });
  }
  if (typeof status !== "string" || !allowedStatuses.has(status as RunStatus)) {
    return json({ ok: false, error: "status is invalid" }, { status: 400 });
  }

  const timestamp = new Date().toISOString();
  const summary = typeof body.summary === "string" ? body.summary : undefined;
  const data = isRecord(body.data) ? body.data : {};
  const dataJson = JSON.stringify({
    ...data,
    workflowIntentId: typeof body.workflowIntentId === "string" ? body.workflowIntentId : undefined,
  });

  await env.DB.prepare(
    `INSERT INTO run_probes (
       user_id, workspace_id, agent_id, run_id, status, summary, data_json, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, workspace_id, run_id) DO UPDATE SET
       status = excluded.status,
       summary = excluded.summary,
       data_json = excluded.data_json,
       updated_at = excluded.updated_at`,
  )
    .bind(
      fixtureScope.userId,
      fixtureScope.workspaceId,
      fixtureAgentId,
      runId,
      status,
      summary,
      dataJson,
      timestamp,
      timestamp,
    )
    .run();

  return json({ ok: true, probe: await readLatestRunProbe(env) });
};

const handleRequest = async (request: Request, env: Env) => {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/health") {
    return json({
      ok: true,
      service: "assistant-mk1-control-plane",
      storage: "d1-local",
    });
  }

  const authResponse = requireAuth(request, env);
  if (authResponse) return authResponse;

  if (request.method === "POST" && url.pathname === "/data-client/runs/probe") {
    return handlePostRunProbe(request, env);
  }

  if (request.method === "GET" && url.pathname === "/data-client/runs/latest") {
    return json({ ok: true, probe: await readLatestRunProbe(env) });
  }

  return json({ ok: false, error: "not found" }, { status: 404 });
};

export default {
  fetch: handleRequest,
};
