import { selectMembership } from "./authz-store";
import { appendControlPlaneEvent } from "./control-plane-events";
import { appendControlAudit } from "./demo-run-store";
import { isRecord, json, parseDataJson, parseJson } from "./http";
import { isAdminMembership } from "./membership-policy";
import {
  createId,
  toJson,
  type AgentIdentity,
  type ControlArtifactRow,
  type ControlToolCallRow,
  type Env,
  type ExecutionMode,
  type TenantScope,
} from "./types";

const urlInspectToolName = "url.inspect";
const urlInspectWorkflowType = "tool.url.inspect";
const urlInspectPolicy = "tool-admin-readonly-v0";
const urlInspectTimeoutMs = 5_000;
const urlInspectMaxBytes = 128 * 1024;

type ToolRunIdentity = AgentIdentity & {
  runId: string;
  workflowIntentId: string;
};

type ToolError = {
  code: string;
  message: string;
  retryable: boolean;
  redacted: true;
};

type UrlInspectOutput = {
  url: string;
  finalUrl: string;
  status: number;
  ok: boolean;
  contentType: string | null;
  contentLength: number | null;
  downloadedBytes: number;
  truncated: boolean;
  title: string | null;
  timingMs: number;
  summary: string;
  retryable: boolean;
};

const toolSummaries = [
  {
    name: "demo.inspect",
    description: "Run the deterministic workspace diagnostic.",
    kind: "native",
    family: "diagnostic",
    status: "available",
    supportedExecutionModes: ["dry_run"],
    requiresSecrets: false,
    mutationRisk: "read_only",
  },
  {
    name: urlInspectToolName,
    description: "Inspect a public URL with a bounded read-only HTTP request.",
    kind: "native",
    family: "web",
    status: "available",
    supportedExecutionModes: ["dry_run"],
    requiresSecrets: false,
    mutationRisk: "read_only",
  },
] as const;

const scopeFromRow = (row: { user_id: string; workspace_id: string }): TenantScope => ({
  userId: row.user_id,
  workspaceId: row.workspace_id,
});

const toToolCallSummary = (row: ControlToolCallRow) => ({
  id: row.id,
  scope: scopeFromRow(row),
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

const toArtifactSummary = (row: ControlArtifactRow) => ({
  id: row.id,
  scope: scopeFromRow(row),
  kind: row.kind,
  uri: row.uri,
  title: row.title ?? undefined,
  mimeType: row.mime_type ?? undefined,
  sizeBytes: row.size_bytes ?? undefined,
  data: parseDataJson(row.data_json),
  createdAt: row.created_at,
});

export const listLatestToolCalls = async (env: Env, scope: TenantScope, limit = 8) => {
  const rows = await env.DB.prepare(
    `SELECT id, user_id, workspace_id, agent_id, workflow_intent_id, run_id, tool_id, status,
            input_summary, output_summary, artifact_refs_json, data_json, started_at,
            finished_at, created_at
     FROM control_tool_calls
     WHERE user_id = ? AND workspace_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
  )
    .bind(scope.userId, scope.workspaceId, limit)
    .all<ControlToolCallRow>();

  return rows.results.map(toToolCallSummary);
};

export const listLatestArtifacts = async (env: Env, scope: TenantScope, limit = 8) => {
  const rows = await env.DB.prepare(
    `SELECT id, user_id, workspace_id, kind, uri, title, mime_type, size_bytes, data_json,
            created_at
     FROM control_artifacts
     WHERE user_id = ? AND workspace_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
  )
    .bind(scope.userId, scope.workspaceId, limit)
    .all<ControlArtifactRow>();

  return rows.results.map(toArtifactSummary);
};

export const resolveToolSummaries = async (env: Env, identity: AgentIdentity) => {
  const membership = await selectMembership(env, identity.scope.userId, identity.scope.workspaceId);
  const canAdminRun = isAdminMembership(membership);

  return toolSummaries.map((tool) => {
    const isUrlInspect = tool.name === urlInspectToolName;
    const adminVisible = canAdminRun && isUrlInspect;
    return {
      ...tool,
      adminVisible,
      modelVisible: false,
      reason: isUrlInspect
        ? adminVisible
          ? "Available in Admin as a read-only dry-run tool. It is not model-visible until policy v0."
          : "Workspace owner/admin membership is required to run this Admin tool."
        : "Diagnostic workflow tool is exposed through the existing diagnostic run path.",
    };
  });
};

const toolError = (code: string, message: string, retryable = false): ToolError => ({
  code,
  message,
  retryable,
  redacted: true,
});

const isPrivateIpv4 = (hostname: string) => {
  const parts = hostname.split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map((part) => Number(part));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
};

const isBlockedHostname = (hostname: string) => {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const isIpv6 = normalized.includes(":");
  return (
    normalized === "localhost" ||
    normalized === "metadata" ||
    normalized === "metadata.google.internal" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    (isIpv6 &&
      (normalized === "::1" ||
        normalized.startsWith("fc") ||
        normalized.startsWith("fd") ||
        normalized.startsWith("fe80:"))) ||
    isPrivateIpv4(normalized)
  );
};

const validateUrlInspectInput = (
  input: unknown,
): { ok: true; url: URL } | { ok: false; status: 400 | 403; error: ToolError } => {
  const rawUrl = isRecord(input) && typeof input.url === "string" ? input.url.trim() : "";
  if (!rawUrl) {
    return {
      ok: false,
      status: 400,
      error: toolError("invalid_input", "input.url is required.", false),
    };
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return {
      ok: false,
      status: 400,
      error: toolError("invalid_url", "URL must be an absolute http or https URL.", false),
    };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      ok: false,
      status: 400,
      error: toolError("unsupported_protocol", "Only http and https URLs can be inspected.", false),
    };
  }

  if (url.username || url.password) {
    return {
      ok: false,
      status: 400,
      error: toolError(
        "url_credentials_rejected",
        "URLs with embedded credentials are rejected.",
        false,
      ),
    };
  }

  if (isBlockedHostname(url.hostname)) {
    return {
      ok: false,
      status: 403,
      error: toolError(
        "url_blocked",
        "Local, private, and metadata hosts cannot be inspected.",
        false,
      ),
    };
  }

  return { ok: true, url };
};

const extractTitle = (text: string) => {
  const match = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match?.[1]) return null;
  return match[1].replace(/\s+/g, " ").trim().slice(0, 180) || null;
};

const readBoundedText = async (response: Response) => {
  if (!response.body) return { text: "", downloadedBytes: 0, truncated: false };

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let downloadedBytes = 0;
  let truncated = false;

  try {
    while (downloadedBytes < urlInspectMaxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const remaining = urlInspectMaxBytes - downloadedBytes;
      if (value.byteLength > remaining) {
        chunks.push(value.slice(0, remaining));
        downloadedBytes += remaining;
        truncated = true;
        break;
      }
      chunks.push(value);
      downloadedBytes += value.byteLength;
    }
  } finally {
    reader.releaseLock();
    if (truncated) await response.body.cancel().catch(() => undefined);
  }

  return {
    text: new TextDecoder().decode(concatChunks(chunks, downloadedBytes)),
    downloadedBytes,
    truncated,
  };
};

const concatChunks = (chunks: Uint8Array[], totalBytes: number) => {
  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
};

const inspectUrl = async (
  url: URL,
): Promise<{ ok: true; output: UrlInspectOutput } | { ok: false; error: ToolError }> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), urlInspectTimeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetch(url.toString(), {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml,application/json,text/plain;q=0.8,*/*;q=0.5",
      },
    });
    const contentType = response.headers.get("content-type");
    const contentLengthHeader = response.headers.get("content-length");
    const contentLength = contentLengthHeader ? Number(contentLengthHeader) : null;
    const readableLength = Number.isFinite(contentLength) ? contentLength : null;
    const body = await readBoundedText(response);
    const isHtml = contentType?.toLowerCase().includes("html") ?? false;
    const title = isHtml ? extractTitle(body.text) : null;
    const timingMs = Date.now() - startedAt;
    const summary = `${response.status} ${response.statusText || ""}`.trim();

    return {
      ok: true,
      output: {
        url: url.toString(),
        finalUrl: response.url,
        status: response.status,
        ok: response.ok,
        contentType,
        contentLength: readableLength,
        downloadedBytes: body.downloadedBytes,
        truncated: body.truncated,
        title,
        timingMs,
        summary: title ? `${summary}: ${title}` : summary,
        retryable: response.status >= 500 || response.status === 429,
      },
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      error: toolError(
        aborted ? "url_inspect_timeout" : "url_inspect_failed",
        aborted
          ? `URL inspection timed out after ${urlInspectTimeoutMs}ms.`
          : "URL inspection failed before a response was available.",
        true,
      ),
    };
  } finally {
    clearTimeout(timeout);
  }
};

const insertToolRunRecords = async (
  env: Env,
  identity: AgentIdentity,
  input: { url: URL; executionMode: ExecutionMode },
): Promise<ToolRunIdentity> => {
  const timestamp = new Date().toISOString();
  const workflowIntentId = createId("cf-intent");
  const runId = createId("cf-run");
  const toolCallId = `${runId}-tool-url-inspect`;
  const execution = { mode: input.executionMode, policy: urlInspectPolicy };

  await env.DB.prepare(
    `INSERT INTO control_workflow_intents (
       id, user_id, workspace_id, agent_id, stage, type, execution_json, payload_json,
       status, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      workflowIntentId,
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.agentId,
      "observe",
      urlInspectWorkflowType,
      toJson(execution),
      toJson({ toolName: urlInspectToolName, input: { url: input.url.toString() } }),
      "running",
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
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.agentId,
      workflowIntentId,
      "running",
      toJson(execution),
      "observe",
      "cloudflare-control-plane",
      timestamp,
      timestamp,
      toJson({
        displayName: "URL inspect",
        toolName: urlInspectToolName,
        policy: urlInspectPolicy,
      }),
      timestamp,
      timestamp,
    )
    .run();

  await env.DB.prepare(
    `INSERT INTO control_tool_calls (
       id, user_id, workspace_id, agent_id, workflow_intent_id, run_id, tool_id, status,
       input_summary, artifact_refs_json, data_json, started_at, created_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      toolCallId,
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.agentId,
      workflowIntentId,
      runId,
      urlInspectToolName,
      "running",
      `Inspect ${input.url.toString()}`,
      "[]",
      toJson({
        input: { url: input.url.toString() },
        execution,
        source: "admin",
      }),
      timestamp,
      timestamp,
    )
    .run();

  const runIdentity = { ...identity, runId, workflowIntentId };
  await appendControlAudit(env, {
    ...runIdentity,
    action: "intent.created",
    summary: "Created URL inspection workflow intent.",
    targetType: "workflowIntent",
    targetId: workflowIntentId,
  });
  await appendControlAudit(env, {
    ...runIdentity,
    action: "tool.started",
    summary: "Started url.inspect tool call.",
    targetType: "toolCall",
    targetId: toolCallId,
  });
  await appendControlPlaneEvent(env, identity, {
    type: "tool.started",
    summary: "Started url.inspect from Admin.",
    targetType: "toolCall",
    targetId: toolCallId,
    data: { runId, workflowIntentId, toolName: urlInspectToolName },
  });

  return runIdentity;
};

const finishToolRun = async (
  env: Env,
  identity: ToolRunIdentity,
  result: { ok: true; output: UrlInspectOutput } | { ok: false; error: ToolError },
) => {
  const timestamp = new Date().toISOString();
  const toolCallId = `${identity.runId}-tool-url-inspect`;
  const artifactId = `${identity.runId}-artifact-url-inspect`;
  const artifactRef = {
    id: artifactId,
    kind: "report",
    uri: `d1://control-plane/${identity.runId}/url-inspect-report.json`,
    title: "URL inspection report",
    mimeType: "application/json",
  };

  if (!result.ok) {
    await env.DB.prepare(
      `UPDATE control_tool_calls
       SET status = ?, output_summary = ?, data_json = ?, finished_at = ?
       WHERE id = ? AND user_id = ? AND workspace_id = ?`,
    )
      .bind(
        "failed",
        result.error.message,
        toJson({ error: result.error }),
        timestamp,
        toolCallId,
        identity.scope.userId,
        identity.scope.workspaceId,
      )
      .run();
    await updateToolRunStatus(env, identity, "failed", result.error.message, {
      error: result.error,
      toolName: urlInspectToolName,
    });
    await appendControlAudit(env, {
      ...identity,
      action: "tool.failed",
      summary: "url.inspect failed.",
      targetType: "toolCall",
      targetId: toolCallId,
      data: { error: result.error },
    });
    await appendControlPlaneEvent(env, identity, {
      type: "tool.failed",
      summary: "url.inspect failed.",
      targetType: "toolCall",
      targetId: toolCallId,
      data: { runId: identity.runId, error: result.error },
    });
    return { toolCallId, artifact: null };
  }

  await env.DB.prepare(
    `INSERT INTO control_artifacts (
       id, user_id, workspace_id, kind, uri, title, mime_type, size_bytes, data_json, created_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      artifactId,
      identity.scope.userId,
      identity.scope.workspaceId,
      "report",
      artifactRef.uri,
      artifactRef.title,
      artifactRef.mimeType,
      JSON.stringify(result.output).length,
      toJson({ output: result.output }),
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
      result.output.summary,
      toJson([artifactRef]),
      toJson({ output: result.output }),
      timestamp,
      toolCallId,
      identity.scope.userId,
      identity.scope.workspaceId,
    )
    .run();

  await updateToolRunStatus(env, identity, "completed", "URL inspection completed.", {
    artifactIds: [artifactId],
    toolName: urlInspectToolName,
    timingMs: result.output.timingMs,
  });
  await appendControlAudit(env, {
    ...identity,
    action: "tool.finished",
    summary: "Finished url.inspect tool call.",
    targetType: "toolCall",
    targetId: toolCallId,
  });
  await appendControlAudit(env, {
    ...identity,
    action: "artifact.created",
    summary: "Created URL inspection artifact metadata.",
    targetType: "artifact",
    targetId: artifactId,
  });
  await appendControlPlaneEvent(env, identity, {
    type: "tool.finished",
    summary: "Finished url.inspect from Admin.",
    targetType: "toolCall",
    targetId: toolCallId,
    data: { runId: identity.runId, artifactId, toolName: urlInspectToolName },
  });

  return { toolCallId, artifact: artifactRef };
};

const updateToolRunStatus = async (
  env: Env,
  identity: ToolRunIdentity,
  status: "completed" | "failed",
  summary: string,
  data: Record<string, unknown>,
) => {
  const timestamp = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE control_runs
     SET status = ?, heartbeat_at = ?, last_event_at = ?, completed_at = ?,
         failed_at = ?, data_json = ?, updated_at = ?
     WHERE user_id = ? AND workspace_id = ? AND id = ?`,
  )
    .bind(
      status,
      timestamp,
      timestamp,
      status === "completed" ? timestamp : null,
      status === "failed" ? timestamp : null,
      toJson({
        displayName: "URL inspect",
        summary,
        ...data,
      }),
      timestamp,
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.runId,
    )
    .run();

  await env.DB.prepare(
    `UPDATE control_workflow_intents
     SET status = ?, updated_at = ?
     WHERE user_id = ? AND workspace_id = ? AND id = ?`,
  )
    .bind(
      status,
      timestamp,
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.workflowIntentId,
    )
    .run();
};

export const handleListTools = async (env: Env, identity: AgentIdentity) => {
  const [tools, latestToolCalls, latestArtifacts] = await Promise.all([
    resolveToolSummaries(env, identity),
    listLatestToolCalls(env, identity.scope),
    listLatestArtifacts(env, identity.scope),
  ]);

  return json({
    ok: true,
    tools,
    latestToolCalls,
    latestArtifacts,
  });
};

export const handleRunTool = async (request: Request, env: Env, identity: AgentIdentity) => {
  const membership = await selectMembership(env, identity.scope.userId, identity.scope.workspaceId);
  if (!isAdminMembership(membership)) {
    return json({ ok: false, error: "Workspace admin role is required" }, { status: 403 });
  }

  const body = parseJson(await request.text());
  const toolName = isRecord(body) && typeof body.toolName === "string" ? body.toolName : "";
  if (toolName !== urlInspectToolName) {
    return json(
      {
        ok: false,
        error: "Unsupported tool",
        details: toolError(
          "unsupported_tool",
          "Only url.inspect can run through this v0 endpoint.",
          false,
        ),
      },
      { status: 400 },
    );
  }

  const executionMode =
    isRecord(body) && typeof body.executionMode === "string" ? body.executionMode : "dry_run";
  if (executionMode !== "dry_run") {
    return json(
      {
        ok: false,
        error: "Unsupported execution mode",
        details: toolError(
          "unsupported_execution_mode",
          "url.inspect only supports dry_run.",
          false,
        ),
      },
      { status: 400 },
    );
  }

  const input = isRecord(body) ? body.input : undefined;
  const validated = validateUrlInspectInput(input);
  if (!validated.ok) {
    return json(
      {
        ok: false,
        error: validated.error.message,
        details: validated.error,
      },
      { status: validated.status },
    );
  }

  const runIdentity = await insertToolRunRecords(env, identity, {
    url: validated.url,
    executionMode,
  });
  const result = await inspectUrl(validated.url);
  const finished = await finishToolRun(env, runIdentity, result);
  const [latestToolCalls, latestArtifacts] = await Promise.all([
    listLatestToolCalls(env, identity.scope),
    listLatestArtifacts(env, identity.scope),
  ]);

  const toolCall = latestToolCalls.find((call) => call.id === finished.toolCallId) ?? null;
  const artifact = finished.artifact
    ? (latestArtifacts.find((item) => item.id === finished.artifact?.id) ?? finished.artifact)
    : null;

  return json(
    {
      ok: result.ok,
      run: {
        id: runIdentity.runId,
        workflowIntentId: runIdentity.workflowIntentId,
        status: result.ok ? "completed" : "failed",
        execution: { mode: executionMode, policy: urlInspectPolicy },
      },
      toolCall,
      artifact,
      error: result.ok ? undefined : result.error,
    },
    { status: result.ok ? 201 : 502 },
  );
};
