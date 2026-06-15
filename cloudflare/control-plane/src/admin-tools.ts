import { selectMembership } from "./authz-store";
import { appendControlPlaneEvent } from "./control-plane-events";
import { appendControlAudit } from "./demo-run-store";
import { isRecord, json, parseDataJson, parseJson } from "./http";
import { isAdminMembership } from "./membership-policy";
import {
  finishTrace,
  recordIncomingRequestSpans,
  recordSpan,
  startTrace,
  type IncomingRuntimeTrace,
  type RuntimeTraceContext,
} from "./runtime-traces";
import { dispatchWorkbenchSessionEvent } from "./session-coordinator";
import {
  demoInspectToolName,
  evaluateToolPolicy,
  isKnownTool,
  recordToolPolicyDecision,
  toolPolicyError,
  updateToolPermissionStatus,
  urlInspectPolicy,
  urlInspectToolName,
} from "./tool-policy";
import {
  createId,
  toJson,
  type AgentIdentity,
  type ControlApprovalRequestRow,
  type ControlArtifactRow,
  type ControlToolCallRow,
  type Env,
  type ExecutionMode,
  type TenantScope,
  type ToolPermissionStatus,
} from "./types";

const urlInspectWorkflowType = "tool.url.inspect";
const urlInspectTimeoutMs = 5_000;
const urlInspectMaxBytes = 128 * 1024;

type ToolRunIdentity = AgentIdentity & {
  runId: string;
  workflowIntentId: string;
  source?: "admin" | "approval" | "model";
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

type UrlInspectRunSource = "admin" | "approval" | "model";

const toolSummaries = [
  {
    name: demoInspectToolName,
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

const toApprovalRequestSummary = (row: ControlApprovalRequestRow) => ({
  id: row.id,
  scope: scopeFromRow(row),
  agentId: row.agent_id,
  workflowIntentId: row.workflow_intent_id,
  runId: row.run_id,
  toolId: row.tool_id,
  status: row.status,
  reason: row.reason,
  data: parseDataJson(row.data_json),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toPolicySummary = (policy: Awaited<ReturnType<typeof evaluateToolPolicy>>) => ({
  decision: policy.decision,
  code: policy.code,
  reason: policy.reason,
  executionMode: policy.executionMode,
  policyReference: policy.policyReference,
});

const readLatestApprovalRequest = async (env: Env, identity: AgentIdentity, toolName: string) =>
  env.DB.prepare(
    `SELECT id, user_id, workspace_id, agent_id, workflow_intent_id, run_id, tool_id, status,
            reason, data_json, created_at, updated_at
     FROM control_approval_requests
     WHERE user_id = ? AND workspace_id = ? AND agent_id = ? AND tool_id = ?
     ORDER BY updated_at DESC, created_at DESC
     LIMIT 1`,
  )
    .bind(identity.scope.userId, identity.scope.workspaceId, identity.agentId, toolName)
    .first<ControlApprovalRequestRow>();

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
  return Promise.all(
    toolSummaries.map(async (tool) => {
      const adminPolicy = await evaluateToolPolicy(env, identity, {
        membership,
        toolName: tool.name,
        executionMode: "dry_run",
        surface: "admin_list",
      });
      const modelPolicy = await evaluateToolPolicy(env, identity, {
        membership,
        toolName: tool.name,
        executionMode: "dry_run",
        surface: "model_exposure",
      });
      const latestApprovalRequest = await readLatestApprovalRequest(env, identity, tool.name);
      const permission = adminPolicy.permission ?? modelPolicy.permission;
      const permissionData = parseDataJson(permission?.data_json ?? "{}");
      const killSwitchReason =
        typeof permissionData.killSwitchReason === "string"
          ? permissionData.killSwitchReason
          : undefined;

      const reason =
        adminPolicy.decision === "allow"
          ? `${adminPolicy.reason} ${modelPolicy.reason}`
          : adminPolicy.reason;

      return {
        ...tool,
        adminVisible: adminPolicy.decision === "allow" && adminPolicy.adminVisible,
        modelVisible: modelPolicy.decision === "allow" && modelPolicy.modelVisible,
        reason,
        permissionStatus: permission?.status,
        policyReference: adminPolicy.policyReference,
        allowedExecutionModes: adminPolicy.allowedExecutionModes,
        approvalRequired: adminPolicy.approvalRequired,
        killSwitchReason,
        adminPolicy: toPolicySummary(adminPolicy),
        modelExposurePolicy: toPolicySummary(modelPolicy),
        latestApprovalRequest: latestApprovalRequest
          ? toApprovalRequestSummary(latestApprovalRequest)
          : undefined,
      };
    }),
  );
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

export const validateUrlInspectInput = (
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

export const inspectUrl = async (
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

export const insertToolRunRecords = async (
  env: Env,
  identity: AgentIdentity,
  input: {
    url: URL;
    executionMode: ExecutionMode;
    policyDecisionId: string;
    source?: UrlInspectRunSource;
    parentRunId?: string | null;
    traceId?: string | null;
  },
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
        policyDecisionId: input.policyDecisionId,
        source: input.source ?? "admin",
        parentRunId: input.parentRunId ?? undefined,
        traceId: input.traceId ?? undefined,
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
        source: input.source ?? "admin",
        policyDecisionId: input.policyDecisionId,
        parentRunId: input.parentRunId ?? undefined,
        traceId: input.traceId ?? undefined,
      }),
      timestamp,
      timestamp,
    )
    .run();

  const runIdentity = { ...identity, runId, workflowIntentId, source: input.source ?? "admin" };
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
    summary: "Started url.inspect tool call.",
    targetType: "toolCall",
    targetId: toolCallId,
    data: {
      runId,
      workflowIntentId,
      toolName: urlInspectToolName,
      source: input.source ?? "admin",
      parentRunId: input.parentRunId ?? undefined,
      traceId: input.traceId ?? undefined,
    },
  });

  return runIdentity;
};

const insertApprovalInterruptedRun = async (
  env: Env,
  identity: AgentIdentity,
  input: {
    url: URL;
    executionMode: ExecutionMode;
    policyDecisionId: string;
    reason: string;
  },
) => {
  const timestamp = new Date().toISOString();
  const workflowIntentId = createId("cf-intent");
  const runId = createId("cf-run");
  const approvalRequestId = createId("cf-approval");
  const execution = { mode: input.executionMode, policy: urlInspectPolicy };
  const payload = { toolName: urlInspectToolName, input: { url: input.url.toString() } };

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
      toJson(payload),
      "interrupted",
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
      "interrupted",
      toJson(execution),
      "observe",
      "cloudflare-control-plane",
      timestamp,
      timestamp,
      toJson({
        displayName: "URL inspect",
        summary: input.reason,
        toolName: urlInspectToolName,
        policy: urlInspectPolicy,
        policyDecisionId: input.policyDecisionId,
        approvalRequestId,
      }),
      timestamp,
      timestamp,
    )
    .run();

  await env.DB.prepare(
    `INSERT INTO control_approval_requests (
       id, user_id, workspace_id, agent_id, workflow_intent_id, run_id, tool_id, status,
       reason, data_json, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      approvalRequestId,
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.agentId,
      workflowIntentId,
      runId,
      urlInspectToolName,
      "requested",
      input.reason,
      toJson({
        input: { url: input.url.toString() },
        execution,
        source: "admin",
        policyDecisionId: input.policyDecisionId,
      }),
      timestamp,
      timestamp,
    )
    .run();

  const runIdentity = { ...identity, runId, workflowIntentId };
  await appendControlAudit(env, {
    ...runIdentity,
    action: "run.interrupted",
    summary: input.reason,
    targetType: "run",
    targetId: runId,
    data: { toolName: urlInspectToolName, approvalRequestId },
  });
  await appendControlAudit(env, {
    ...runIdentity,
    action: "approval.requested",
    summary: input.reason,
    targetType: "approvalRequest",
    targetId: approvalRequestId,
    data: { toolName: urlInspectToolName },
  });
  await appendControlPlaneEvent(env, identity, {
    type: "run.interrupted",
    summary: input.reason,
    targetType: "run",
    targetId: runId,
    data: { runId, workflowIntentId, toolName: urlInspectToolName, approvalRequestId },
  });
  await appendControlPlaneEvent(env, identity, {
    type: "approval.requested",
    summary: input.reason,
    targetType: "approvalRequest",
    targetId: approvalRequestId,
    data: { runId, workflowIntentId, toolName: urlInspectToolName },
  });

  return { runId, workflowIntentId, approvalRequestId };
};

export const finishToolRun = async (
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
      data: { runId: identity.runId, error: result.error, source: identity.source ?? "admin" },
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
    summary: "Finished url.inspect tool call.",
    targetType: "toolCall",
    targetId: toolCallId,
    data: {
      runId: identity.runId,
      artifactId,
      toolName: urlInspectToolName,
      source: identity.source ?? "admin",
    },
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

const readApprovalRequest = async (env: Env, identity: AgentIdentity, approvalRequestId: string) =>
  env.DB.prepare(
    `SELECT id, user_id, workspace_id, agent_id, workflow_intent_id, run_id, tool_id, status,
            reason, data_json, created_at, updated_at
     FROM control_approval_requests
     WHERE id = ? AND user_id = ? AND workspace_id = ? AND agent_id = ?
     LIMIT 1`,
  )
    .bind(approvalRequestId, identity.scope.userId, identity.scope.workspaceId, identity.agentId)
    .first<ControlApprovalRequestRow>();

const updateApprovalStatus = async (
  env: Env,
  approval: ControlApprovalRequestRow,
  status: "approved" | "denied" | "failed",
  data: Record<string, unknown>,
) => {
  const timestamp = new Date().toISOString();
  const existing = parseDataJson(approval.data_json);
  await env.DB.prepare(
    `UPDATE control_approval_requests
     SET status = ?, data_json = ?, updated_at = ?
     WHERE id = ? AND user_id = ? AND workspace_id = ?`,
  )
    .bind(
      status,
      toJson({
        ...existing,
        ...data,
        decidedAt: timestamp,
      }),
      timestamp,
      approval.id,
      approval.user_id,
      approval.workspace_id,
    )
    .run();
};

const markInterruptedRunRunning = async (
  env: Env,
  identity: AgentIdentity,
  approval: ControlApprovalRequestRow,
) => {
  const timestamp = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE control_runs
     SET status = ?, heartbeat_at = ?, last_event_at = ?, data_json = ?, updated_at = ?
     WHERE id = ? AND user_id = ? AND workspace_id = ? AND agent_id = ?`,
  )
    .bind(
      "running",
      timestamp,
      timestamp,
      toJson({
        displayName: "URL inspect",
        summary: "Approval granted; URL inspection resumed.",
        toolName: urlInspectToolName,
        approvalRequestId: approval.id,
      }),
      timestamp,
      approval.run_id,
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.agentId,
    )
    .run();

  await env.DB.prepare(
    `UPDATE control_workflow_intents
     SET status = ?, updated_at = ?
     WHERE id = ? AND user_id = ? AND workspace_id = ? AND agent_id = ?`,
  )
    .bind(
      "running",
      timestamp,
      approval.workflow_intent_id,
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.agentId,
    )
    .run();
};

const markInterruptedRunCancelled = async (
  env: Env,
  identity: AgentIdentity,
  approval: ControlApprovalRequestRow,
  summary: string,
) => {
  const timestamp = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE control_runs
     SET status = ?, heartbeat_at = ?, last_event_at = ?, completed_at = ?, data_json = ?,
         updated_at = ?
     WHERE id = ? AND user_id = ? AND workspace_id = ? AND agent_id = ?`,
  )
    .bind(
      "cancelled",
      timestamp,
      timestamp,
      timestamp,
      toJson({
        displayName: "URL inspect",
        summary,
        toolName: urlInspectToolName,
        approvalRequestId: approval.id,
      }),
      timestamp,
      approval.run_id,
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.agentId,
    )
    .run();

  await env.DB.prepare(
    `UPDATE control_workflow_intents
     SET status = ?, updated_at = ?
     WHERE id = ? AND user_id = ? AND workspace_id = ? AND agent_id = ?`,
  )
    .bind(
      "cancelled",
      timestamp,
      approval.workflow_intent_id,
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.agentId,
    )
    .run();
};

const insertApprovedToolCallRecord = async (
  env: Env,
  identity: AgentIdentity,
  approval: ControlApprovalRequestRow,
  input: { url: URL; executionMode: ExecutionMode; policyDecisionId: string },
): Promise<ToolRunIdentity> => {
  const timestamp = new Date().toISOString();
  const toolCallId = `${approval.run_id}-tool-url-inspect`;
  const execution = { mode: input.executionMode, policy: urlInspectPolicy };

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
      approval.workflow_intent_id,
      approval.run_id,
      urlInspectToolName,
      "running",
      `Inspect ${input.url.toString()}`,
      "[]",
      toJson({
        input: { url: input.url.toString() },
        execution,
        source: "approval",
        approvalRequestId: approval.id,
        policyDecisionId: input.policyDecisionId,
      }),
      timestamp,
      timestamp,
    )
    .run();

  const runIdentity = {
    ...identity,
    runId: approval.run_id,
    workflowIntentId: approval.workflow_intent_id,
    source: "approval" as const,
  };
  await appendControlAudit(env, {
    ...runIdentity,
    action: "run.resumed",
    summary: "Resumed URL inspection after approval.",
    targetType: "run",
    targetId: approval.run_id,
    data: { toolName: urlInspectToolName, approvalRequestId: approval.id },
  });
  await appendControlAudit(env, {
    ...runIdentity,
    action: "tool.started",
    summary: "Started approved url.inspect tool call.",
    targetType: "toolCall",
    targetId: toolCallId,
  });
  await appendControlPlaneEvent(env, identity, {
    type: "run.resumed",
    summary: "Resumed URL inspection after approval.",
    targetType: "run",
    targetId: approval.run_id,
    data: {
      runId: approval.run_id,
      workflowIntentId: approval.workflow_intent_id,
      toolName: urlInspectToolName,
      approvalRequestId: approval.id,
    },
  });
  await appendControlPlaneEvent(env, identity, {
    type: "tool.started",
    summary: "Started approved url.inspect tool call.",
    targetType: "toolCall",
    targetId: toolCallId,
    data: {
      runId: approval.run_id,
      workflowIntentId: approval.workflow_intent_id,
      toolName: urlInspectToolName,
      approvalRequestId: approval.id,
    },
  });

  return runIdentity;
};

const approvalRequestBody = (approval: ControlApprovalRequestRow, status?: string) => ({
  id: approval.id,
  status: status ?? approval.status,
  reason: approval.reason,
  createdAt: approval.created_at,
  updatedAt: approval.updated_at,
});

const approvalListStatuses = new Set(["requested", "decided", "all"]);

const toApprovalDecisionSummary = (data: Record<string, unknown>) => {
  const error = isRecord(data.error) ? data.error : undefined;
  return {
    decidedAt: typeof data.decidedAt === "string" ? data.decidedAt : undefined,
    decidedByUserId: typeof data.decidedByUserId === "string" ? data.decidedByUserId : undefined,
    denyReason: typeof data.denyReason === "string" ? data.denyReason : undefined,
    policyDecisionId: typeof data.policyDecisionId === "string" ? data.policyDecisionId : undefined,
    error:
      error && (typeof error.code === "string" || typeof error.message === "string")
        ? {
            code: typeof error.code === "string" ? error.code : undefined,
            message: typeof error.message === "string" ? error.message : undefined,
          }
        : undefined,
  };
};

const summarizeApprovalRequest = async (
  env: Env,
  identity: AgentIdentity,
  membership: Awaited<ReturnType<typeof selectMembership>>,
  row: ControlApprovalRequestRow,
) => {
  const data = parseDataJson(row.data_json);
  const input = isRecord(data.input) ? data.input : {};
  const execution = isRecord(data.execution) ? data.execution : {};
  const currentPolicy =
    row.status === "requested"
      ? await evaluateToolPolicy(env, identity, {
          membership,
          toolName: row.tool_id,
          executionMode: "dry_run",
          surface: "admin_resume",
        })
      : null;

  return {
    id: row.id,
    scope: scopeFromRow(row),
    agentId: row.agent_id,
    workflowIntentId: row.workflow_intent_id,
    runId: row.run_id,
    toolId: row.tool_id,
    status: row.status,
    reason: row.reason,
    input:
      typeof input.url === "string"
        ? {
            url: input.url,
          }
        : undefined,
    source: typeof data.source === "string" ? data.source : undefined,
    executionMode: typeof execution.mode === "string" ? execution.mode : undefined,
    policyDecisionId: typeof data.policyDecisionId === "string" ? data.policyDecisionId : undefined,
    decision: toApprovalDecisionSummary(data),
    currentPolicy: currentPolicy ? toPolicySummary(currentPolicy) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const readApprovalRequestSummary = async (
  env: Env,
  identity: AgentIdentity,
  membership: Awaited<ReturnType<typeof selectMembership>>,
  approvalRequestId: string,
) => {
  const row = await readApprovalRequest(env, identity, approvalRequestId);
  return row ? summarizeApprovalRequest(env, identity, membership, row) : null;
};

const requireActiveAdminMembership = async (env: Env, identity: AgentIdentity) => {
  const membership = await selectMembership(env, identity.scope.userId, identity.scope.workspaceId);
  if (membership && membership.status === "active" && isAdminMembership(membership)) {
    return { ok: true as const, membership };
  }
  const policy = await evaluateToolPolicy(env, identity, {
    membership,
    toolName: urlInspectToolName,
    executionMode: "dry_run",
    surface: "admin_list",
  });
  return {
    ok: false as const,
    membership,
    error: toolError(
      policy.code === "inactive_membership" ? "inactive_membership" : "admin_required",
      policy.code === "inactive_membership"
        ? "Workspace membership is not active."
        : "Workspace owner/admin membership is required to manage tool approvals.",
      false,
    ),
  };
};

const dispatchApprovalUpdated = async (
  env: Env,
  identity: AgentIdentity,
  input: {
    approvalRequestId: string;
    status: string;
    runId?: string;
    workflowIntentId?: string;
    toolName?: string;
    reason?: string;
  },
) => {
  await appendControlPlaneEvent(env, identity, {
    type: "approval.updated",
    summary: input.reason ?? `Approval ${input.status}.`,
    targetType: "approvalRequest",
    targetId: input.approvalRequestId,
    data: {
      approvalRequestId: input.approvalRequestId,
      status: input.status,
      runId: input.runId,
      workflowIntentId: input.workflowIntentId,
      toolName: input.toolName ?? urlInspectToolName,
    },
  });
  await dispatchWorkbenchSessionEvent(env, identity, {
    type: "approval.updated",
    data: {
      approvalRequestId: input.approvalRequestId,
      status: input.status,
      runId: input.runId,
      workflowIntentId: input.workflowIntentId,
      toolName: input.toolName ?? urlInspectToolName,
    },
  });
};

export const handleListToolApprovals = async (
  request: Request,
  env: Env,
  identity: AgentIdentity,
) => {
  const admin = await requireActiveAdminMembership(env, identity);
  if (!admin.ok) {
    return json(
      {
        ok: false,
        error: admin.error.message,
        details: admin.error,
      },
      { status: 403 },
    );
  }

  const url = new URL(request.url);
  const requestedStatus = url.searchParams.get("status") ?? "all";
  const status = approvalListStatuses.has(requestedStatus) ? requestedStatus : "all";
  const requestedLimit = Number(url.searchParams.get("limit") ?? "20");
  const limit = Math.max(1, Math.min(50, Number.isFinite(requestedLimit) ? requestedLimit : 20));
  const rows = await env.DB.prepare(
    `SELECT id, user_id, workspace_id, agent_id, workflow_intent_id, run_id, tool_id, status,
            reason, data_json, created_at, updated_at
     FROM control_approval_requests
     WHERE user_id = ? AND workspace_id = ? AND agent_id = ?
       AND (
         ? = 'all'
         OR (? = 'requested' AND status = 'requested')
         OR (? = 'decided' AND status <> 'requested')
       )
     ORDER BY CASE WHEN status = 'requested' THEN 0 ELSE 1 END, updated_at DESC, created_at DESC
     LIMIT ?`,
  )
    .bind(
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.agentId,
      status,
      status,
      status,
      limit,
    )
    .all<ControlApprovalRequestRow>();

  const approvals = await Promise.all(
    rows.results.map((row) => summarizeApprovalRequest(env, identity, admin.membership, row)),
  );

  return json({
    ok: true,
    status,
    approvals,
  });
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

const policyUpdateStatuses = new Set<ToolPermissionStatus>(["enabled", "disabled"]);

export const handleUpdateToolPolicy = async (
  request: Request,
  env: Env,
  identity: AgentIdentity,
) => {
  const body = parseJson(await request.text());
  const toolName = isRecord(body) && typeof body.toolName === "string" ? body.toolName : "";
  const status = isRecord(body) && typeof body.status === "string" ? body.status : undefined;
  const requiresApproval =
    isRecord(body) && typeof body.requiresApproval === "boolean"
      ? body.requiresApproval
      : undefined;
  const modelVisible =
    isRecord(body) && typeof body.modelVisible === "boolean" ? body.modelVisible : undefined;
  const killSwitchReason =
    isRecord(body) && typeof body.killSwitchReason === "string"
      ? body.killSwitchReason.trim().slice(0, 240)
      : undefined;

  if (!isKnownTool(toolName) || toolName !== urlInspectToolName) {
    return json(
      {
        ok: false,
        error: "Unsupported tool",
        details: toolError(
          "unsupported_tool",
          "Only url.inspect policy can be updated through this v0 endpoint.",
          false,
        ),
      },
      { status: 400 },
    );
  }

  if (status !== undefined && !policyUpdateStatuses.has(status as ToolPermissionStatus)) {
    return json(
      {
        ok: false,
        error: "Unsupported policy status",
        details: toolError(
          "unsupported_policy_status",
          "Policy status must be enabled or disabled.",
          false,
        ),
      },
      { status: 400 },
    );
  }

  if (
    status === undefined &&
    requiresApproval === undefined &&
    modelVisible === undefined &&
    killSwitchReason === undefined
  ) {
    return json(
      {
        ok: false,
        error: "No policy changes requested",
        details: toolError(
          "invalid_policy_update",
          "Provide status, requiresApproval, modelVisible, or killSwitchReason.",
          false,
        ),
      },
      { status: 400 },
    );
  }

  const membership = await selectMembership(env, identity.scope.userId, identity.scope.workspaceId);
  if (!membership || membership.status !== "active" || !isAdminMembership(membership)) {
    const policy = await evaluateToolPolicy(env, identity, {
      membership,
      toolName,
      executionMode: "dry_run",
      surface: "admin_list",
    });
    const decisionId = await recordToolPolicyDecision(env, identity, {
      toolName,
      surface: "admin_list",
      result: policy,
      data: {
        action: "tool.policy.update",
        requestedStatus: status,
        requestedRequiresApproval: requiresApproval,
        requestedModelVisible: modelVisible,
      },
    });
    return json(
      {
        ok: false,
        error: policy.reason,
        details: toolPolicyError(policy),
        policyDecisionId: decisionId,
      },
      { status: policy.status },
    );
  }

  const permission = await updateToolPermissionStatus(env, identity, {
    toolName,
    status: status as ToolPermissionStatus | undefined,
    requiresApproval,
    killSwitchReason,
    modelVisible,
  });
  const tools = await resolveToolSummaries(env, identity);
  const tool = tools.find((item) => item.name === toolName);
  await appendControlPlaneEvent(env, identity, {
    type: "tool.policy.updated",
    summary: `${toolName} policy updated.`,
    targetType: "toolPermission",
    targetId: permission?.id,
    data: {
      toolName,
      status: permission?.status,
      requiresApproval,
      modelVisible,
      killSwitchReason,
    },
  });
  await dispatchWorkbenchSessionEvent(env, identity, {
    type: "admin.summary.invalidated",
    data: {
      reason: "tool-policy-updated",
      toolName,
      status: permission?.status,
    },
  });

  return json({
    ok: true,
    toolName,
    status: permission?.status,
    requiresApproval: tool?.approvalRequired,
    modelVisible: tool?.modelVisible,
    permissionId: permission?.id,
    tool,
  });
};

const finishToolTrace = async (
  env: Env,
  identity: AgentIdentity,
  trace: RuntimeTraceContext | null,
  input: Parameters<typeof finishTrace>[3],
) => {
  if (!trace) return;
  await finishTrace(env, identity, trace, input);
};

const requireAdminToolPolicy = async (env: Env, identity: AgentIdentity) => {
  const membership = await selectMembership(env, identity.scope.userId, identity.scope.workspaceId);
  if (membership && membership.status === "active" && isAdminMembership(membership)) {
    return { ok: true as const, membership };
  }
  const policy = await evaluateToolPolicy(env, identity, {
    membership,
    toolName: urlInspectToolName,
    executionMode: "dry_run",
    surface: "admin_list",
  });
  const decisionId = await recordToolPolicyDecision(env, identity, {
    toolName: urlInspectToolName,
    surface: "admin_list",
    result: policy,
    data: { action: "tool.approval.manage" },
  });
  return { ok: false as const, policy, decisionId };
};

export const handleApproveToolApproval = async (
  env: Env,
  identity: AgentIdentity,
  approvalRequestId: string,
) => {
  if (!approvalRequestId) {
    return json(
      {
        ok: false,
        error: "Approval request id is required",
        details: toolError("invalid_approval_request", "Approval request id is required.", false),
      },
      { status: 400 },
    );
  }

  const admin = await requireAdminToolPolicy(env, identity);
  if (!admin.ok) {
    return json(
      {
        ok: false,
        error: admin.policy.reason,
        details: toolPolicyError(admin.policy),
        policyDecisionId: admin.decisionId,
      },
      { status: admin.policy.status },
    );
  }

  const approval = await readApprovalRequest(env, identity, approvalRequestId);
  if (!approval) {
    return json(
      {
        ok: false,
        error: "Approval request not found",
        details: toolError(
          "approval_not_found",
          "Approval request was not found in this workspace scope.",
          false,
        ),
      },
      { status: 404 },
    );
  }
  if (approval.status !== "requested") {
    return json(
      {
        ok: false,
        error: "Approval request is already decided",
        approvalRequest: approvalRequestBody(approval),
        details: toolError(
          "approval_already_decided",
          "Only requested approvals can be approved.",
          false,
        ),
      },
      { status: 409 },
    );
  }

  const approvalData = parseDataJson(approval.data_json);
  const originalInput = isRecord(approvalData.input) ? approvalData.input : undefined;
  const validated = validateUrlInspectInput(originalInput);
  if (!validated.ok) {
    await updateApprovalStatus(env, approval, "failed", {
      decidedByUserId: identity.scope.userId,
      error: validated.error,
    });
    await markInterruptedRunCancelled(env, identity, approval, validated.error.message);
    await dispatchApprovalUpdated(env, identity, {
      approvalRequestId: approval.id,
      status: "failed",
      runId: approval.run_id,
      workflowIntentId: approval.workflow_intent_id,
      toolName: approval.tool_id,
      reason: validated.error.message,
    });
    const failedApproval = await readApprovalRequestSummary(
      env,
      identity,
      admin.membership,
      approval.id,
    );
    return json(
      {
        ok: false,
        error: validated.error.message,
        approvalRequest: failedApproval ?? approvalRequestBody(approval, "failed"),
        details: validated.error,
      },
      { status: validated.status },
    );
  }

  const policy = await evaluateToolPolicy(env, identity, {
    membership: admin.membership,
    toolName: approval.tool_id,
    executionMode: "dry_run",
    surface: "admin_resume",
  });
  const policyDecisionId = await recordToolPolicyDecision(env, identity, {
    toolName: approval.tool_id,
    surface: "admin_resume",
    result: policy,
    data: { action: "approval.approve", approvalRequestId: approval.id },
  });
  if (policy.decision === "block") {
    return json(
      {
        ok: false,
        error: policy.reason,
        approvalRequest: approvalRequestBody(approval),
        details: toolPolicyError(policy),
        policyDecisionId,
      },
      { status: policy.status },
    );
  }

  await updateApprovalStatus(env, approval, "approved", {
    decidedByUserId: identity.scope.userId,
    policyDecisionId,
  });
  await markInterruptedRunRunning(env, identity, approval);
  await appendControlAudit(env, {
    ...identity,
    runId: approval.run_id,
    workflowIntentId: approval.workflow_intent_id,
    action: "approval.approved",
    summary: "Approved url.inspect execution.",
    targetType: "approvalRequest",
    targetId: approval.id,
    data: { toolName: urlInspectToolName, policyDecisionId },
  });
  await appendControlPlaneEvent(env, identity, {
    type: "approval.approved",
    summary: "Approved url.inspect execution.",
    targetType: "approvalRequest",
    targetId: approval.id,
    data: {
      runId: approval.run_id,
      workflowIntentId: approval.workflow_intent_id,
      toolName: urlInspectToolName,
      policyDecisionId,
    },
  });
  await dispatchApprovalUpdated(env, identity, {
    approvalRequestId: approval.id,
    status: "approved",
    runId: approval.run_id,
    workflowIntentId: approval.workflow_intent_id,
    toolName: approval.tool_id,
    reason: "Approved url.inspect execution.",
  });

  const runIdentity = await insertApprovedToolCallRecord(env, identity, approval, {
    url: validated.url,
    executionMode: policy.executionMode,
    policyDecisionId,
  });
  const result = await inspectUrl(validated.url);
  const finished = await finishToolRun(env, runIdentity, result);
  await dispatchWorkbenchSessionEvent(env, identity, {
    type: "tool.run.updated",
    data: {
      toolName: urlInspectToolName,
      runId: approval.run_id,
      workflowIntentId: approval.workflow_intent_id,
      toolCallId: finished.toolCallId,
      artifactId: finished.artifact?.id ?? null,
      approvalRequestId: approval.id,
      status: result.ok ? "completed" : "failed",
      errorCode: result.ok ? undefined : result.error.code,
    },
  });
  await dispatchWorkbenchSessionEvent(env, identity, {
    type: "admin.summary.invalidated",
    data: {
      reason: "approval-approved",
      toolName: urlInspectToolName,
      runId: approval.run_id,
    },
  });

  const [latestToolCalls, latestArtifacts] = await Promise.all([
    listLatestToolCalls(env, identity.scope),
    listLatestArtifacts(env, identity.scope),
  ]);
  const toolCall = latestToolCalls.find((call) => call.id === finished.toolCallId) ?? null;
  const artifact = finished.artifact
    ? (latestArtifacts.find((item) => item.id === finished.artifact?.id) ?? finished.artifact)
    : null;
  const approvedApproval = await readApprovalRequestSummary(
    env,
    identity,
    admin.membership,
    approval.id,
  );

  return json(
    {
      ok: result.ok,
      run: {
        id: approval.run_id,
        workflowIntentId: approval.workflow_intent_id,
        status: result.ok ? "completed" : "failed",
        execution: { mode: policy.executionMode, policy: urlInspectPolicy },
        policyDecisionId,
      },
      approvalRequest: approvedApproval ?? approvalRequestBody(approval, "approved"),
      toolCall,
      artifact,
      error: result.ok ? undefined : result.error,
      policyDecisionId,
    },
    { status: result.ok ? 200 : 502 },
  );
};

export const handleDenyToolApproval = async (
  request: Request,
  env: Env,
  identity: AgentIdentity,
  approvalRequestId: string,
) => {
  if (!approvalRequestId) {
    return json(
      {
        ok: false,
        error: "Approval request id is required",
        details: toolError("invalid_approval_request", "Approval request id is required.", false),
      },
      { status: 400 },
    );
  }

  const admin = await requireAdminToolPolicy(env, identity);
  if (!admin.ok) {
    return json(
      {
        ok: false,
        error: admin.policy.reason,
        details: toolPolicyError(admin.policy),
        policyDecisionId: admin.decisionId,
      },
      { status: admin.policy.status },
    );
  }

  const approval = await readApprovalRequest(env, identity, approvalRequestId);
  if (!approval) {
    return json(
      {
        ok: false,
        error: "Approval request not found",
        details: toolError(
          "approval_not_found",
          "Approval request was not found in this workspace scope.",
          false,
        ),
      },
      { status: 404 },
    );
  }
  if (approval.status !== "requested") {
    return json(
      {
        ok: false,
        error: "Approval request is already decided",
        approvalRequest: approvalRequestBody(approval),
        details: toolError(
          "approval_already_decided",
          "Only requested approvals can be denied.",
          false,
        ),
      },
      { status: 409 },
    );
  }

  const body = parseJson(await request.text());
  const denyReason =
    isRecord(body) && typeof body.reason === "string" && body.reason.trim()
      ? body.reason.trim().slice(0, 240)
      : "Approval denied by workspace admin.";
  await updateApprovalStatus(env, approval, "denied", {
    decidedByUserId: identity.scope.userId,
    denyReason,
  });
  await markInterruptedRunCancelled(env, identity, approval, denyReason);
  await appendControlAudit(env, {
    ...identity,
    runId: approval.run_id,
    workflowIntentId: approval.workflow_intent_id,
    action: "approval.denied",
    summary: denyReason,
    targetType: "approvalRequest",
    targetId: approval.id,
    data: { toolName: urlInspectToolName },
  });
  await appendControlAudit(env, {
    ...identity,
    runId: approval.run_id,
    workflowIntentId: approval.workflow_intent_id,
    action: "run.cancelled",
    summary: denyReason,
    targetType: "run",
    targetId: approval.run_id,
    data: { toolName: urlInspectToolName, approvalRequestId: approval.id },
  });
  await appendControlPlaneEvent(env, identity, {
    type: "approval.denied",
    summary: denyReason,
    targetType: "approvalRequest",
    targetId: approval.id,
    data: {
      runId: approval.run_id,
      workflowIntentId: approval.workflow_intent_id,
      toolName: urlInspectToolName,
    },
  });
  await appendControlPlaneEvent(env, identity, {
    type: "run.cancelled",
    summary: denyReason,
    targetType: "run",
    targetId: approval.run_id,
    data: {
      runId: approval.run_id,
      workflowIntentId: approval.workflow_intent_id,
      toolName: urlInspectToolName,
      approvalRequestId: approval.id,
    },
  });
  await dispatchApprovalUpdated(env, identity, {
    approvalRequestId: approval.id,
    status: "denied",
    runId: approval.run_id,
    workflowIntentId: approval.workflow_intent_id,
    toolName: approval.tool_id,
    reason: denyReason,
  });
  await dispatchWorkbenchSessionEvent(env, identity, {
    type: "tool.run.updated",
    data: {
      toolName: urlInspectToolName,
      runId: approval.run_id,
      workflowIntentId: approval.workflow_intent_id,
      approvalRequestId: approval.id,
      status: "cancelled",
    },
  });
  await dispatchWorkbenchSessionEvent(env, identity, {
    type: "admin.summary.invalidated",
    data: {
      reason: "approval-denied",
      toolName: urlInspectToolName,
      runId: approval.run_id,
    },
  });
  const deniedApproval = await readApprovalRequestSummary(
    env,
    identity,
    admin.membership,
    approval.id,
  );

  return json({
    ok: true,
    run: {
      id: approval.run_id,
      workflowIntentId: approval.workflow_intent_id,
      status: "cancelled",
      execution: { mode: "dry_run", policy: urlInspectPolicy },
    },
    approvalRequest: deniedApproval ?? approvalRequestBody(approval, "denied"),
    toolCall: null,
    artifact: null,
  });
};

export const handleRunTool = async (
  request: Request,
  env: Env,
  identity: AgentIdentity,
  incomingTrace?: IncomingRuntimeTrace,
) => {
  const bodyText = await request.text();
  const body = parseJson(bodyText);
  const toolName = isRecord(body) && typeof body.toolName === "string" ? body.toolName : "";
  const trace =
    toolName === urlInspectToolName
      ? await startTrace(env, identity, {
          traceId: incomingTrace?.traceId,
          kind: "tool.url.inspect",
          rootName: "URL inspect",
          summary: "Run Admin-triggered read-only URL inspection.",
          startedAtMs: incomingTrace?.authzStartedAtMs,
          data: { toolName: urlInspectToolName },
        })
      : null;
  if (trace) await recordIncomingRequestSpans(env, identity, trace, incomingTrace);

  const executionMode =
    isRecord(body) && typeof body.executionMode === "string" ? body.executionMode : "dry_run";
  const policyStartedAtMs = Date.now();
  const membership = await selectMembership(env, identity.scope.userId, identity.scope.workspaceId);
  const policy = await evaluateToolPolicy(env, identity, {
    membership,
    toolName,
    executionMode,
    surface: "admin_run",
  });
  const policyDecisionId = await recordToolPolicyDecision(env, identity, {
    toolName,
    surface: "admin_run",
    result: policy,
    data: { requestedToolName: toolName },
  });
  if (trace) {
    await recordSpan(env, identity, {
      traceId: trace.traceId,
      name: "Tool policy check",
      layer: "cloudflare",
      startedAtMs: policyStartedAtMs,
      status: policy.decision === "allow" ? "completed" : "blocked",
      data: {
        role: membership?.role ?? null,
        toolName,
        code: policy.code,
        policyDecisionId,
      },
    });
  }

  if (policy.decision === "block" && policy.code !== "approval_required") {
    if (trace) {
      await finishToolTrace(env, identity, trace, {
        status: "blocked",
        summary: policy.reason,
        data: { errorCode: policy.code, policyDecisionId },
      });
    }
    return json(
      {
        ok: false,
        error: policy.reason,
        details: toolPolicyError(policy),
        policyDecisionId,
      },
      { status: policy.status },
    );
  }

  const input = isRecord(body) ? body.input : undefined;
  const validated = validateUrlInspectInput(input);
  if (!validated.ok) {
    if (trace) {
      await recordSpan(env, identity, {
        traceId: trace.traceId,
        name: "Input validation",
        layer: "cloudflare",
        startedAtMs: Date.now(),
        status: validated.status === 403 ? "blocked" : "failed",
        data: { code: validated.error.code, url: isRecord(input) ? input.url : undefined },
      });
      await finishToolTrace(env, identity, trace, {
        status: validated.status === 403 ? "blocked" : "failed",
        summary: validated.error.message,
        data: { error: validated.error },
      });
    }
    return json(
      {
        ok: false,
        error: validated.error.message,
        details: validated.error,
      },
      { status: validated.status },
    );
  }

  if (policy.code === "approval_required") {
    const approvalStartedAtMs = Date.now();
    const interrupted = await insertApprovalInterruptedRun(env, identity, {
      url: validated.url,
      executionMode: policy.executionMode,
      policyDecisionId,
      reason: policy.reason,
    });
    if (trace) {
      await recordSpan(env, identity, {
        traceId: trace.traceId,
        name: "Approval request recorded",
        layer: "d1",
        startedAtMs: approvalStartedAtMs,
        status: "blocked",
        data: {
          runId: interrupted.runId,
          workflowIntentId: interrupted.workflowIntentId,
          approvalRequestId: interrupted.approvalRequestId,
        },
      });
      await finishToolTrace(env, identity, trace, {
        status: "blocked",
        summary: policy.reason,
        data: {
          runId: interrupted.runId,
          workflowIntentId: interrupted.workflowIntentId,
          approvalRequestId: interrupted.approvalRequestId,
          policyDecisionId,
          errorCode: policy.code,
        },
      });
    }
    await dispatchWorkbenchSessionEvent(env, identity, {
      type: "tool.run.updated",
      data: {
        toolName: urlInspectToolName,
        runId: interrupted.runId,
        workflowIntentId: interrupted.workflowIntentId,
        approvalRequestId: interrupted.approvalRequestId,
        status: "interrupted",
        traceId: trace?.traceId,
        errorCode: policy.code,
      },
    });
    await dispatchApprovalUpdated(env, identity, {
      approvalRequestId: interrupted.approvalRequestId,
      status: "requested",
      runId: interrupted.runId,
      workflowIntentId: interrupted.workflowIntentId,
      toolName: urlInspectToolName,
      reason: policy.reason,
    });
    if (trace) {
      await dispatchWorkbenchSessionEvent(env, identity, {
        type: "trace.updated",
        data: {
          traceId: trace.traceId,
          kind: trace.kind,
          status: "blocked",
          runId: interrupted.runId,
        },
      });
    }
    await dispatchWorkbenchSessionEvent(env, identity, {
      type: "admin.summary.invalidated",
      data: {
        reason: "approval-requested",
        toolName: urlInspectToolName,
        runId: interrupted.runId,
        traceId: trace?.traceId,
      },
    });
    return json(
      {
        ok: false,
        run: {
          id: interrupted.runId,
          workflowIntentId: interrupted.workflowIntentId,
          status: "interrupted",
          execution: { mode: policy.executionMode, policy: urlInspectPolicy },
          policyDecisionId,
        },
        approvalRequest: {
          id: interrupted.approvalRequestId,
          status: "requested",
          reason: policy.reason,
        },
        error: policy.reason,
        details: toolPolicyError(policy),
        policyDecisionId,
      },
      { status: policy.status },
    );
  }

  const recordsStartedAtMs = Date.now();
  const runIdentity = await insertToolRunRecords(env, identity, {
    url: validated.url,
    executionMode: policy.executionMode,
    policyDecisionId,
  });
  if (trace) {
    await recordSpan(env, identity, {
      traceId: trace.traceId,
      name: "Run queued and tool-call record write",
      layer: "d1",
      startedAtMs: recordsStartedAtMs,
      data: { runId: runIdentity.runId, workflowIntentId: runIdentity.workflowIntentId },
    });
  }
  const toolStartedAtMs = Date.now();
  if (trace) {
    await recordSpan(env, identity, {
      traceId: trace.traceId,
      name: "Tool started",
      layer: "tool",
      startedAtMs: toolStartedAtMs,
      endedAtMs: toolStartedAtMs,
      data: { toolName: urlInspectToolName, executionMode },
    });
  }
  const fetchStartedAtMs = Date.now();
  const result = await inspectUrl(validated.url);
  if (trace) {
    await recordSpan(env, identity, {
      traceId: trace.traceId,
      name: "HTTP fetch",
      layer: "tool",
      startedAtMs: fetchStartedAtMs,
      status: result.ok ? "completed" : "failed",
      data: result.ok
        ? {
            status: result.output.status,
            finalUrl: result.output.finalUrl,
            downloadedBytes: result.output.downloadedBytes,
          }
        : { error: result.error },
    });
  }
  const finishStartedAtMs = Date.now();
  const finished = await finishToolRun(env, runIdentity, result);
  if (trace) {
    await recordSpan(env, identity, {
      traceId: trace.traceId,
      name: result.ok ? "Artifact/write completion" : "Failure write",
      layer: "d1",
      startedAtMs: finishStartedAtMs,
      status: result.ok ? "completed" : "failed",
      data: {
        runId: runIdentity.runId,
        toolCallId: finished.toolCallId,
        artifactId: finished.artifact?.id ?? null,
      },
    });
    await finishToolTrace(env, identity, trace, {
      status: result.ok ? "completed" : "failed",
      summary: result.ok ? result.output.summary : result.error.message,
      data: {
        runId: runIdentity.runId,
        workflowIntentId: runIdentity.workflowIntentId,
        toolCallId: finished.toolCallId,
        artifactId: finished.artifact?.id ?? null,
        toolName: urlInspectToolName,
        error: result.ok ? undefined : result.error,
      },
    });
  }
  await dispatchWorkbenchSessionEvent(env, identity, {
    type: "tool.run.updated",
    data: {
      toolName: urlInspectToolName,
      runId: runIdentity.runId,
      workflowIntentId: runIdentity.workflowIntentId,
      toolCallId: finished.toolCallId,
      artifactId: finished.artifact?.id ?? null,
      status: result.ok ? "completed" : "failed",
      traceId: trace?.traceId,
      errorCode: result.ok ? undefined : result.error.code,
    },
  });
  if (trace) {
    await dispatchWorkbenchSessionEvent(env, identity, {
      type: "trace.updated",
      data: {
        traceId: trace.traceId,
        kind: trace.kind,
        status: result.ok ? "completed" : "failed",
        runId: runIdentity.runId,
      },
    });
  }
  await dispatchWorkbenchSessionEvent(env, identity, {
    type: "admin.summary.invalidated",
    data: {
      reason: "tool-run-updated",
      toolName: urlInspectToolName,
      runId: runIdentity.runId,
      traceId: trace?.traceId,
    },
  });
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
        execution: { mode: policy.executionMode, policy: urlInspectPolicy },
        policyDecisionId,
      },
      toolCall,
      artifact,
      error: result.ok ? undefined : result.error,
    },
    { status: result.ok ? 201 : 502 },
  );
};
