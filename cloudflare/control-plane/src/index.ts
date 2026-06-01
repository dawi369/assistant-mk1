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
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
};

type D1Database = {
  prepare(query: string): D1PreparedStatement;
};

type Env = {
  DB: D1Database;
  CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN?: string;
  WORKBENCH_EXECUTOR_URL?: string;
  WORKBENCH_EXECUTOR_TOKEN?: string;
};

type WorkerExecutionContext = {
  waitUntil(promise: Promise<unknown>): void;
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
const demoExecution = { mode: "dry_run", policy: "fixture-demo" };
const demoWorkflowType = "demo.inspect";

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

const parseJson = (raw: string) => {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
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

type ControlIntentRow = {
  id: string;
  user_id: string;
  workspace_id: string;
  agent_id: string;
  stage: string;
  type: string;
  execution_json: string;
  payload_json: string;
  status: string;
  created_at: string;
  updated_at: string;
};

type ControlRunRow = {
  id: string;
  user_id: string;
  workspace_id: string;
  agent_id: string;
  workflow_intent_id: string;
  status: RunStatus;
  execution_json: string;
  stage: string | null;
  engine: string | null;
  heartbeat_at: string | null;
  last_event_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  data_json: string;
  created_at: string;
  updated_at: string;
};

type ControlToolCallRow = {
  id: string;
  user_id: string;
  workspace_id: string;
  agent_id: string;
  workflow_intent_id: string;
  run_id: string;
  tool_id: string;
  status: string;
  input_summary: string | null;
  output_summary: string | null;
  artifact_refs_json: string;
  data_json: string;
  started_at: string;
  finished_at: string | null;
  created_at: string;
};

type ControlArtifactRow = {
  id: string;
  user_id: string;
  workspace_id: string;
  kind: string;
  uri: string;
  title: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  data_json: string;
  created_at: string;
};

type ControlDecisionRow = {
  id: string;
  user_id: string;
  workspace_id: string;
  agent_id: string;
  title: string;
  summary: string;
  thesis: string;
  status: string;
  provenance_refs_json: string;
  artifact_refs_json: string;
  created_at: string;
  updated_at: string;
};

type ControlAuditRow = {
  id: string;
  user_id: string;
  workspace_id: string;
  action: string;
  summary: string;
  target_type: string | null;
  target_id: string | null;
  data_json: string;
  created_at: string;
};

const createId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

const toJson = (value: unknown) => JSON.stringify(value ?? {});

const toIntent = (row: ControlIntentRow) => ({
  id: row.id,
  scope: fixtureScope,
  agentId: row.agent_id,
  stage: row.stage,
  type: row.type,
  execution: parseDataJson(row.execution_json),
  payload: parseDataJson(row.payload_json),
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toRun = (row: ControlRunRow) => ({
  id: row.id,
  scope: fixtureScope,
  agentId: row.agent_id,
  workflowIntentId: row.workflow_intent_id,
  status: row.status,
  execution: parseDataJson(row.execution_json),
  stage: row.stage ?? undefined,
  engine: row.engine ?? undefined,
  heartbeatAt: row.heartbeat_at ?? undefined,
  lastEventAt: row.last_event_at ?? undefined,
  completedAt: row.completed_at ?? undefined,
  failedAt: row.failed_at ?? undefined,
  data: parseDataJson(row.data_json),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toToolCall = (row: ControlToolCallRow) => ({
  id: row.id,
  scope: fixtureScope,
  agentId: row.agent_id,
  workflowIntentId: row.workflow_intent_id,
  runId: row.run_id,
  toolId: row.tool_id,
  status: row.status,
  inputSummary: row.input_summary ?? undefined,
  outputSummary: row.output_summary ?? undefined,
  artifactRefs: parseJson(row.artifact_refs_json) ?? [],
  data: parseDataJson(row.data_json),
  startedAt: row.started_at,
  finishedAt: row.finished_at ?? undefined,
  createdAt: row.created_at,
});

const toArtifact = (row: ControlArtifactRow) => ({
  id: row.id,
  scope: fixtureScope,
  kind: row.kind,
  uri: row.uri,
  title: row.title ?? undefined,
  mimeType: row.mime_type ?? undefined,
  sizeBytes: row.size_bytes ?? undefined,
  data: parseDataJson(row.data_json),
  createdAt: row.created_at,
});

const toDecision = (row: ControlDecisionRow) => ({
  id: row.id,
  scope: fixtureScope,
  agentId: row.agent_id,
  title: row.title,
  summary: row.summary,
  thesis: row.thesis,
  status: row.status,
  provenanceRefs: parseJson(row.provenance_refs_json) ?? [],
  artifactRefs: parseJson(row.artifact_refs_json) ?? [],
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toAuditEvent = (row: ControlAuditRow) => ({
  id: row.id,
  scope: fixtureScope,
  actor: { type: "system", name: "Cloudflare Control Plane" },
  action: row.action,
  summary: row.summary,
  target:
    row.target_type && row.target_id ? { type: row.target_type, id: row.target_id } : undefined,
  data: parseDataJson(row.data_json),
  createdAt: row.created_at,
});

const appendControlAudit = async (
  env: Env,
  input: {
    runId: string;
    workflowIntentId: string;
    action: string;
    summary: string;
    targetType?: string;
    targetId?: string;
    data?: Record<string, unknown>;
  },
) => {
  const timestamp = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO control_audit_events (
       id, user_id, workspace_id, action, summary, target_type, target_id, data_json, created_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      createId("cf-audit"),
      fixtureScope.userId,
      fixtureScope.workspaceId,
      input.action,
      input.summary,
      input.targetType,
      input.targetId,
      toJson({
        eventName: input.action,
        runId: input.runId,
        workflowIntentId: input.workflowIntentId,
        ...input.data,
      }),
      timestamp,
    )
    .run();
};

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

const readControlRun = async (env: Env, runId: string) =>
  env.DB.prepare(
    `SELECT id, user_id, workspace_id, agent_id, workflow_intent_id, status, execution_json,
            stage, engine, heartbeat_at, last_event_at, completed_at, failed_at, data_json,
            created_at, updated_at
     FROM control_runs
     WHERE user_id = ? AND workspace_id = ? AND id = ?
     LIMIT 1`,
  )
    .bind(fixtureScope.userId, fixtureScope.workspaceId, runId)
    .first<ControlRunRow>();

const readLatestControlRun = async (env: Env) =>
  env.DB.prepare(
    `SELECT id, user_id, workspace_id, agent_id, workflow_intent_id, status, execution_json,
            stage, engine, heartbeat_at, last_event_at, completed_at, failed_at, data_json,
            created_at, updated_at
     FROM control_runs
     WHERE user_id = ? AND workspace_id = ?
     ORDER BY updated_at DESC, created_at DESC
     LIMIT 1`,
  )
    .bind(fixtureScope.userId, fixtureScope.workspaceId)
    .first<ControlRunRow>();

const getControlRunSnapshot = async (env: Env, runId: string) => {
  const runRow = await readControlRun(env, runId);
  if (!runRow) return null;

  const intentRow = await env.DB.prepare(
    `SELECT id, user_id, workspace_id, agent_id, stage, type, execution_json, payload_json,
            status, created_at, updated_at
     FROM control_workflow_intents
     WHERE user_id = ? AND workspace_id = ? AND id = ?
     LIMIT 1`,
  )
    .bind(fixtureScope.userId, fixtureScope.workspaceId, runRow.workflow_intent_id)
    .first<ControlIntentRow>();

  const toolCalls = await env.DB.prepare(
    `SELECT id, user_id, workspace_id, agent_id, workflow_intent_id, run_id, tool_id, status,
            input_summary, output_summary, artifact_refs_json, data_json, started_at,
            finished_at, created_at
     FROM control_tool_calls
     WHERE user_id = ? AND workspace_id = ? AND run_id = ?
     ORDER BY created_at ASC`,
  )
    .bind(fixtureScope.userId, fixtureScope.workspaceId, runId)
    .all<ControlToolCallRow>();

  const artifacts = await env.DB.prepare(
    `SELECT id, user_id, workspace_id, kind, uri, title, mime_type, size_bytes, data_json, created_at
     FROM control_artifacts
     WHERE user_id = ? AND workspace_id = ? AND id LIKE ?
     ORDER BY created_at ASC`,
  )
    .bind(fixtureScope.userId, fixtureScope.workspaceId, `${runId}-%`)
    .all<ControlArtifactRow>();

  const decisions = await env.DB.prepare(
    `SELECT id, user_id, workspace_id, agent_id, title, summary, thesis, status,
            provenance_refs_json, artifact_refs_json, created_at, updated_at
     FROM control_decisions
     WHERE user_id = ? AND workspace_id = ? AND id LIKE ?
     ORDER BY created_at ASC`,
  )
    .bind(fixtureScope.userId, fixtureScope.workspaceId, `${runId}-%`)
    .all<ControlDecisionRow>();

  const auditEvents = await env.DB.prepare(
    `SELECT id, user_id, workspace_id, action, summary, target_type, target_id, data_json,
            created_at
     FROM control_audit_events
     WHERE user_id = ? AND workspace_id = ? AND json_extract(data_json, '$.runId') = ?
     ORDER BY created_at ASC`,
  )
    .bind(fixtureScope.userId, fixtureScope.workspaceId, runId)
    .all<ControlAuditRow>();

  return {
    scope: fixtureScope,
    intent: intentRow ? toIntent(intentRow) : null,
    run: toRun(runRow),
    toolCalls: toolCalls.results.map(toToolCall),
    artifacts: artifacts.results.map(toArtifact),
    decisions: decisions.results.map(toDecision),
    auditEvents: auditEvents.results.map(toAuditEvent),
  };
};

const updateControlRunStatus = async (
  env: Env,
  input: {
    runId: string;
    workflowIntentId: string;
    status: RunStatus;
    summary?: string;
    data?: Record<string, unknown>;
  },
) => {
  const timestamp = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE control_runs
     SET status = ?, heartbeat_at = ?, last_event_at = ?, completed_at = ?,
         failed_at = ?, data_json = ?, updated_at = ?
     WHERE user_id = ? AND workspace_id = ? AND id = ?`,
  )
    .bind(
      input.status,
      timestamp,
      timestamp,
      input.status === "completed" ? timestamp : null,
      input.status === "failed" ? timestamp : null,
      toJson({
        displayName: "Cloudflare-owned demo inspect",
        summary: input.summary,
        ...input.data,
      }),
      timestamp,
      fixtureScope.userId,
      fixtureScope.workspaceId,
      input.runId,
    )
    .run();

  await env.DB.prepare(
    `UPDATE control_workflow_intents
     SET status = ?, updated_at = ?
     WHERE user_id = ? AND workspace_id = ? AND id = ?`,
  )
    .bind(
      input.status,
      timestamp,
      fixtureScope.userId,
      fixtureScope.workspaceId,
      input.workflowIntentId,
    )
    .run();
};

const markControlRunFailed = async (
  env: Env,
  input: { runId: string; workflowIntentId: string; summary: string; error?: string },
) => {
  await updateControlRunStatus(env, {
    runId: input.runId,
    workflowIntentId: input.workflowIntentId,
    status: "failed",
    summary: input.summary,
    data: { error: input.error },
  });
  await appendControlAudit(env, {
    runId: input.runId,
    workflowIntentId: input.workflowIntentId,
    action: "run.failed",
    summary: input.summary,
    targetType: "run",
    targetId: input.runId,
    data: { error: input.error },
  });
};

const dispatchDemoExecutor = async (
  env: Env,
  origin: string,
  runId: string,
  workflowIntentId: string,
) => {
  if (!env.WORKBENCH_EXECUTOR_URL || !env.WORKBENCH_EXECUTOR_TOKEN) {
    await markControlRunFailed(env, {
      runId,
      workflowIntentId,
      summary: "Workbench executor is not configured.",
    });
    return;
  }

  try {
    const response = await fetch(env.WORKBENCH_EXECUTOR_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.WORKBENCH_EXECUTOR_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        runId,
        workflowIntentId,
        callbackUrl: `${origin}/internal/workbench/run-callbacks`,
        callbackToken: env.CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN,
      }),
    });

    if (!response.ok) {
      await markControlRunFailed(env, {
        runId,
        workflowIntentId,
        summary: "Workbench executor request failed.",
        error: `${response.status} ${await response.text()}`,
      });
    }
  } catch (error) {
    await markControlRunFailed(env, {
      runId,
      workflowIntentId,
      summary: "Workbench executor request failed.",
      error: error instanceof Error ? error.message : "Unknown executor request failure",
    });
  }
};

const handleStartCloudflareDemoRun = async (
  request: Request,
  env: Env,
  ctx: WorkerExecutionContext,
) => {
  const timestamp = new Date().toISOString();
  const workflowIntentId = createId("cf-intent");
  const runId = createId("cf-run");

  await env.DB.prepare(
    `INSERT INTO control_workflow_intents (
       id, user_id, workspace_id, agent_id, stage, type, execution_json, payload_json,
       status, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      workflowIntentId,
      fixtureScope.userId,
      fixtureScope.workspaceId,
      fixtureAgentId,
      "observe",
      demoWorkflowType,
      toJson(demoExecution),
      toJson({ target: "workspace", requestedBy: "cloudflare-control-plane" }),
      "queued",
      timestamp,
      timestamp,
    )
    .run();

  await env.DB.prepare(
    `INSERT INTO control_runs (
       id, user_id, workspace_id, agent_id, workflow_intent_id, status, execution_json,
       stage, engine, heartbeat_at, last_event_at, data_json, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      runId,
      fixtureScope.userId,
      fixtureScope.workspaceId,
      fixtureAgentId,
      workflowIntentId,
      "queued",
      toJson(demoExecution),
      "observe",
      "cloudflare-control-plane",
      timestamp,
      timestamp,
      toJson({ displayName: "Cloudflare-owned demo inspect" }),
      timestamp,
      timestamp,
    )
    .run();

  await appendControlAudit(env, {
    runId,
    workflowIntentId,
    action: "intent.created",
    summary: "Created Cloudflare-owned demo.inspect workflow intent.",
    targetType: "workflowIntent",
    targetId: workflowIntentId,
  });
  await appendControlAudit(env, {
    runId,
    workflowIntentId,
    action: "run.queued",
    summary: "Queued Cloudflare-owned demo run.",
    targetType: "run",
    targetId: runId,
  });

  ctx.waitUntil(dispatchDemoExecutor(env, new URL(request.url).origin, runId, workflowIntentId));

  return json({ ok: true, snapshot: await getControlRunSnapshot(env, runId) }, { status: 201 });
};

const handleLatestCloudflareDemoRun = async (env: Env) => {
  const run = await readLatestControlRun(env);
  return json({
    ok: true,
    snapshot: run ? await getControlRunSnapshot(env, run.id) : null,
  });
};

const handleGetCloudflareDemoRun = async (env: Env, runId: string) => {
  const snapshot = await getControlRunSnapshot(env, runId);
  if (!snapshot) return json({ ok: false, error: "Demo run not found" }, { status: 404 });
  return json({ ok: true, snapshot });
};

const handleRunCallback = async (request: Request, env: Env) => {
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
  const workflowIntentId = body.workflowIntentId;
  const event = body.event;
  if (typeof runId !== "string" || typeof workflowIntentId !== "string") {
    return json({ ok: false, error: "runId and workflowIntentId are required" }, { status: 400 });
  }

  if (event === "run.started") {
    const timestamp = new Date().toISOString();
    const toolCallId = `${runId}-tool-demo-inspect`;
    await updateControlRunStatus(env, {
      runId,
      workflowIntentId,
      status: "running",
      summary: "Executor started Cloudflare-owned demo run.",
    });
    await env.DB.prepare(
      `INSERT INTO control_tool_calls (
         id, user_id, workspace_id, agent_id, workflow_intent_id, run_id, tool_id, status,
         input_summary, artifact_refs_json, data_json, started_at, created_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    )
      .bind(
        toolCallId,
        fixtureScope.userId,
        fixtureScope.workspaceId,
        fixtureAgentId,
        workflowIntentId,
        runId,
        demoWorkflowType,
        "running",
        "Inspect fixture workspace in dry-run mode.",
        "[]",
        toJson({ source: "next-workbench-executor" }),
        timestamp,
        timestamp,
      )
      .run();
    await appendControlAudit(env, {
      runId,
      workflowIntentId,
      action: "run.started",
      summary: "Started Cloudflare-owned demo run.",
      targetType: "run",
      targetId: runId,
    });
    await appendControlAudit(env, {
      runId,
      workflowIntentId,
      action: "tool.started",
      summary: "Started demo.inspect tool call.",
      targetType: "toolCall",
      targetId: toolCallId,
    });
    return json({ ok: true, snapshot: await getControlRunSnapshot(env, runId) });
  }

  if (event === "run.completed") {
    const output = isRecord(body.output) ? body.output : {};
    const timestamp = new Date().toISOString();
    const toolCallId = `${runId}-tool-demo-inspect`;
    const artifactId = `${runId}-artifact-demo-inspect`;
    const decisionId = `${runId}-decision-demo-inspect`;
    const artifactRef = {
      id: artifactId,
      kind: "report",
      uri: `d1://control-plane/${runId}/inspect-report.json`,
      title: "Cloudflare-owned demo inspect report",
      mimeType: "application/json",
    };

    await env.DB.prepare(
      `INSERT INTO control_artifacts (
         id, user_id, workspace_id, kind, uri, title, mime_type, size_bytes, data_json, created_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json`,
    )
      .bind(
        artifactId,
        fixtureScope.userId,
        fixtureScope.workspaceId,
        "report",
        artifactRef.uri,
        artifactRef.title,
        artifactRef.mimeType,
        JSON.stringify(output).length,
        toJson({ output }),
        timestamp,
      )
      .run();
    await env.DB.prepare(
      `UPDATE control_tool_calls
       SET status = ?, output_summary = ?, artifact_refs_json = ?, data_json = ?, finished_at = ?
       WHERE id = ? AND user_id = ? AND workspace_id = ?`,
    )
      .bind(
        "completed",
        typeof body.outputSummary === "string" ? body.outputSummary : "demo.inspect completed.",
        toJson([artifactRef]),
        toJson({ output }),
        timestamp,
        toolCallId,
        fixtureScope.userId,
        fixtureScope.workspaceId,
      )
      .run();
    await env.DB.prepare(
      `INSERT INTO control_decisions (
         id, user_id, workspace_id, agent_id, title, summary, thesis, status,
         provenance_refs_json, artifact_refs_json, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`,
    )
      .bind(
        decisionId,
        fixtureScope.userId,
        fixtureScope.workspaceId,
        fixtureAgentId,
        "Cloudflare-owned demo inspect completed",
        "The Cloudflare-owned fixture run delegated execution and persisted callbacks.",
        "Assistant-MK1 can let Cloudflare own run coordination while Next/Fly executes work.",
        "active",
        toJson([
          {
            id: toolCallId,
            kind: "tool_result",
            title: "demo.inspect result",
            capturedAt: timestamp,
          },
        ]),
        toJson([artifactRef]),
        timestamp,
        timestamp,
      )
      .run();
    await appendControlAudit(env, {
      runId,
      workflowIntentId,
      action: "tool.finished",
      summary: "Finished demo.inspect tool call.",
      targetType: "toolCall",
      targetId: toolCallId,
    });
    await appendControlAudit(env, {
      runId,
      workflowIntentId,
      action: "artifact.created",
      summary: "Created Cloudflare-owned demo inspect artifact metadata.",
      targetType: "artifact",
      targetId: artifactId,
    });
    await appendControlAudit(env, {
      runId,
      workflowIntentId,
      action: "decision.created",
      summary: "Created Cloudflare-owned demo decision record.",
      targetType: "decision",
      targetId: decisionId,
    });
    await updateControlRunStatus(env, {
      runId,
      workflowIntentId,
      status: "completed",
      summary: "Cloudflare-owned demo run completed.",
      data: { artifactIds: [artifactId], decisionIds: [decisionId] },
    });
    await appendControlAudit(env, {
      runId,
      workflowIntentId,
      action: "run.completed",
      summary: "Completed Cloudflare-owned demo run.",
      targetType: "run",
      targetId: runId,
    });
    return json({ ok: true, snapshot: await getControlRunSnapshot(env, runId) });
  }

  if (event === "run.failed") {
    await markControlRunFailed(env, {
      runId,
      workflowIntentId,
      summary: typeof body.summary === "string" ? body.summary : "Executor reported failure.",
      error: typeof body.error === "string" ? body.error : undefined,
    });
    return json({ ok: true, snapshot: await getControlRunSnapshot(env, runId) });
  }

  return json({ ok: false, error: "unsupported callback event" }, { status: 400 });
};

const handleRequest = async (request: Request, env: Env, ctx: WorkerExecutionContext) => {
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

  if (request.method === "POST" && url.pathname === "/workbench/demo-runs") {
    return handleStartCloudflareDemoRun(request, env, ctx);
  }

  if (request.method === "GET" && url.pathname === "/workbench/demo-runs/latest") {
    return handleLatestCloudflareDemoRun(env);
  }

  const demoRunMatch = url.pathname.match(/^\/workbench\/demo-runs\/([^/]+)$/);
  if (request.method === "GET" && demoRunMatch?.[1]) {
    return handleGetCloudflareDemoRun(env, demoRunMatch[1]);
  }

  if (request.method === "POST" && url.pathname === "/internal/workbench/run-callbacks") {
    return handleRunCallback(request, env);
  }

  return json({ ok: false, error: "not found" }, { status: 404 });
};

export default {
  fetch: handleRequest,
};
