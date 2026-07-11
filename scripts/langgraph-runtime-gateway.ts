import { timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

import {
  canonicalFacadeRequest,
  facadeContentSha256Header,
  facadeSignatureHeader,
  facadeSignatureNonceHeader,
  facadeSignatureTimestampHeader,
  hmacSha256Base64Url,
  signFacadeRequest,
  sha256Base64Url,
} from "../lib/workbench/control-plane-signing";
import { validateUrlInspectInput } from "../lib/workbench/url-inspect";
import { inspectPublicUrl } from "./public-url-inspect";
import {
  adminTestToolError,
  runnerEchoToolName,
  validateRunnerEchoInput,
  type RunnerEchoOutput,
  type RunnerEchoResult,
} from "../lib/workbench/admin-test-tools";
import {
  repoSnapshotError,
  repoSnapshotToolName,
  validateRepoSnapshotInput,
  type RepoSnapshotCommandMetric,
  type RepoSnapshotOutput,
  type RepoSnapshotResult,
} from "../lib/workbench/repo-snapshot";
import {
  executeDemoInspectExecutorRequest,
  type DemoInspectExecutorRequest,
  validateDemoInspectExecutorRequest,
} from "../lib/workbench/demo-inspect-executor";

const port = Number(process.env.PORT ?? 3000);
const langGraphUpstreamUrl = (
  process.env.LANGGRAPH_UPSTREAM_URL ?? "http://127.0.0.1:2024"
).replace(/\/$/, "");
const runnerInvocationPath = "/workbench/tool-runners/invocations";
const signatureWindowMs = 5 * 60 * 1000;
const runnerNonces = new Map<string, number>();
const e2eMode = process.env.WORKBENCH_E2E_MODE === "true";
const requestedE2eDelayMs = Number(process.env.WORKBENCH_E2E_RUNNER_DELAY_MS ?? "0");
if (requestedE2eDelayMs > 0 && !e2eMode) {
  throw new Error("WORKBENCH_E2E_RUNNER_DELAY_MS requires WORKBENCH_E2E_MODE=true");
}
const e2eRunnerDelayMs = e2eMode
  ? Math.min(5_000, Math.max(0, Math.trunc(requestedE2eDelayMs || 0)))
  : 0;
const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const json = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
};

const readBody = async (request: IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};

const readJsonBody = async <T>(request: IncomingMessage): Promise<T | null> => {
  const body = await readBody(request);
  if (body.length === 0) return null;

  return parseJsonBuffer<T>(body);
};

const parseJsonBuffer = <T>(body: Buffer): T | null => {
  try {
    return JSON.parse(body.toString("utf8")) as T;
  } catch {
    return null;
  }
};

const constantTimeEqual = (a: string, b: string) => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
};

const bearerToken = (value: string) => `Bearer ${value}`;

const firstHeader = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const headerValue = (request: IncomingMessage, name: string) =>
  firstHeader(request.headers[name.toLowerCase()])?.trim() ?? "";

const assistantHeaders = (request: IncomingMessage) => {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.headers)) {
    const item = firstHeader(value);
    if (item && key.toLowerCase().startsWith("x-assistant-mk1-")) {
      headers[key.toLowerCase()] = item;
    }
  }
  return headers;
};

const isAuthorized = (request: IncomingMessage, token: string) => {
  const apiKey = Array.isArray(request.headers["x-api-key"])
    ? request.headers["x-api-key"][0]
    : request.headers["x-api-key"];
  const authorization = request.headers.authorization;
  if (apiKey && constantTimeEqual(apiKey, token)) return true;
  if (authorization && constantTimeEqual(authorization, bearerToken(token))) return true;
  return false;
};

const requireProxyAuth = (request: IncomingMessage, response: ServerResponse) => {
  const token = process.env.LANGGRAPH_PROXY_TOKEN;
  if (!token) {
    json(response, 500, { ok: false, error: "LANGGRAPH_PROXY_TOKEN is not configured" });
    return false;
  }

  if (!isAuthorized(request, token)) {
    json(response, 401, { ok: false, error: "unauthorized" });
    return false;
  }

  return true;
};

const requireExecutorAuth = (request: IncomingMessage, response: ServerResponse) => {
  const token = process.env.WORKBENCH_EXECUTOR_TOKEN;
  if (!token) {
    json(response, 500, { ok: false, error: "WORKBENCH_EXECUTOR_TOKEN is not configured" });
    return false;
  }

  const authorization = request.headers.authorization;
  if (!authorization || !constantTimeEqual(authorization, bearerToken(token))) {
    json(response, 401, { ok: false, error: "unauthorized" });
    return false;
  }

  return true;
};

const authError = (response: ServerResponse, code: string, message: string, status = 401) => {
  json(response, status, {
    ok: false,
    error: message,
    details: { code, message, retryable: false, redacted: true },
  });
};

const verifyRunnerSignature = async (
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  body: Buffer,
) => {
  const secret = process.env.WORKBENCH_RUNNER_SIGNING_SECRET?.trim();
  if (!secret) {
    authError(
      response,
      "runner_signature_not_configured",
      "Runner signing is not configured.",
      500,
    );
    return false;
  }

  const signature = headerValue(request, facadeSignatureHeader);
  const timestamp = headerValue(request, facadeSignatureTimestampHeader);
  const nonce = headerValue(request, facadeSignatureNonceHeader);
  const declaredBodyHash = headerValue(request, facadeContentSha256Header);
  if (!signature || !timestamp || !nonce || !declaredBodyHash) {
    authError(response, "signature_required", "Signed runner request is required.");
    return false;
  }

  const timestampMs = Number(timestamp);
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > signatureWindowMs) {
    authError(response, "signature_stale", "Signed runner request is stale.");
    return false;
  }

  const bodyText = body.toString("utf8");
  const actualBodyHash = await sha256Base64Url(bodyText);
  if (!constantTimeEqual(actualBodyHash, declaredBodyHash)) {
    authError(response, "body_hash_mismatch", "Signed runner body hash is invalid.");
    return false;
  }

  const now = Date.now();
  for (const [storedNonce, expiresAt] of runnerNonces) {
    if (expiresAt <= now) runnerNonces.delete(storedNonce);
  }
  if (runnerNonces.has(nonce)) {
    authError(response, "signature_replay", "Signed runner nonce was already used.");
    return false;
  }

  const canonical = canonicalFacadeRequest({
    method: request.method ?? "GET",
    pathWithQuery: `${url.pathname}${url.search}`,
    timestamp,
    nonce,
    bodyHash: declaredBodyHash,
    headers: assistantHeaders(request),
  });
  const expectedSignature = await hmacSha256Base64Url(secret, canonical);
  if (!constantTimeEqual(expectedSignature, signature)) {
    authError(response, "signature_invalid", "Signed runner request is invalid.");
    return false;
  }

  runnerNonces.set(nonce, now + signatureWindowMs);
  return true;
};

const isLangGraphReady = async () => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 750);

  try {
    const response = await fetch(`${langGraphUpstreamUrl}/ok`, {
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
};

const handleDemoInspectExecutor = async (request: IncomingMessage, response: ServerResponse) => {
  if (request.method !== "POST") {
    json(response, 405, { ok: false, error: "method not allowed" });
    return;
  }
  if (!requireExecutorAuth(request, response)) return;

  const body = await readJsonBody<DemoInspectExecutorRequest>(request);
  if (!body) {
    json(response, 400, { ok: false, error: "request body must be JSON" });
    return;
  }

  const parsed = validateDemoInspectExecutorRequest(body);
  if (!parsed.ok) {
    json(response, 400, { ok: false, error: parsed.error });
    return;
  }

  json(response, 200, await executeDemoInspectExecutorRequest(parsed.request));
};

type ToolRunnerInvocation = {
  toolName?: string;
  input?: unknown;
  scope?: {
    userId?: unknown;
    workspaceId?: unknown;
  };
  agentId?: unknown;
  runId?: unknown;
  workflowIntentId?: unknown;
  policyDecisionId?: unknown;
  source?: unknown;
  traceId?: unknown;
  callback?: {
    url?: unknown;
    protocolVersion?: unknown;
    traceId?: unknown;
  };
  runner?: {
    transport?: unknown;
    adapterVersion?: unknown;
    source?: unknown;
    sandbox?: {
      network?: {
        egress?: unknown;
        allowedSchemes?: unknown;
        allowedHosts?: unknown;
        deniedHosts?: unknown;
        privateNetwork?: unknown;
      };
    };
  };
};

type WorkflowCallbackPayload = {
  event: "run.started" | "artifact.created" | "run.completed" | "run.failed";
  runId: string;
  workflowIntentId: string;
  summary?: string;
  sequence?: number;
  traceId?: string;
  toolCall?: {
    id: string;
    toolId: string;
    status?: string;
    outputSummary?: string;
    artifactRefs?: unknown[];
    data?: Record<string, unknown>;
  };
  artifact?: {
    id: string;
    kind: string;
    uri: string;
    title?: string;
    mimeType?: string;
    sizeBytes?: number;
    data?: Record<string, unknown>;
  };
  outputSummary?: string;
  error?: string;
  output?: Record<string, unknown>;
};

type RunnerToolResult = RepoSnapshotResult | RunnerEchoResult;

const repoSnapshotTimeoutMs = 10_000;
const repoSnapshotMaxStdoutBytes = 64 * 1024;
const repoSnapshotMaxStderrBytes = 8 * 1024;

const redactOutput = (value: string) =>
  value
    .replace(/(api[_-]?key|token|secret|password)=?[^\s"']*/gi, "$1=[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]");

const byteSlice = (value: string, maxBytes: number) => {
  const buffer = Buffer.from(value, "utf8");
  if (buffer.length <= maxBytes) return value;
  return `${buffer.subarray(0, maxBytes).toString("utf8")}\n[truncated]`;
};

const runSnapshotCommand = async (
  name: string,
  command: string,
  args: string[],
): Promise<{ metric: RepoSnapshotCommandMetric; stdout: string; stderr: string }> => {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: { ...process.env, PATH: process.env.PATH ?? "" },
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, repoSnapshotTimeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = byteSlice(stdout + chunk.toString("utf8"), repoSnapshotMaxStdoutBytes);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = byteSlice(stderr + chunk.toString("utf8"), repoSnapshotMaxStderrBytes);
    });
    child.on("error", (error: Error) => {
      clearTimeout(timeout);
      const durationMs = Date.now() - startedAt;
      resolve({
        stdout: "",
        stderr: redactOutput(error.message),
        metric: {
          name,
          command: [command, ...args].join(" "),
          status: "unavailable",
          durationMs,
          stdoutBytes: 0,
          stderrBytes: Buffer.byteLength(error.message),
        },
      });
    });
    child.on("close", (code: number | null) => {
      clearTimeout(timeout);
      const safeStdout = redactOutput(stdout);
      const safeStderr = redactOutput(stderr);
      resolve({
        stdout: safeStdout,
        stderr: safeStderr,
        metric: {
          name,
          command: [command, ...args].join(" "),
          status: timedOut ? "timeout" : code === 0 ? "completed" : "failed",
          durationMs: Date.now() - startedAt,
          exitCode: code ?? undefined,
          stdoutBytes: Buffer.byteLength(safeStdout),
          stderrBytes: Buffer.byteLength(safeStderr),
        },
      });
    });
  });
};

const readPackageJson = async () => {
  try {
    const parsed = JSON.parse(await readFile("package.json", "utf8")) as {
      packageManager?: string;
      scripts?: Record<string, unknown>;
    };
    return {
      packageManager: parsed.packageManager,
      scripts: parsed.scripts
        ? Object.keys(parsed.scripts)
            .filter((name) => /^[a-z0-9:_-]{1,64}$/i.test(name))
            .sort()
            .slice(0, 40)
        : [],
    };
  } catch {
    return { packageManager: undefined, scripts: [] };
  }
};

const runRepoSnapshot = async (input: unknown): Promise<RepoSnapshotResult> => {
  const parsed = validateRepoSnapshotInput(input);
  if ("code" in parsed) return { ok: false, error: parsed };
  const startedAt = Date.now();
  const [files, docs, configs, packageInfo] = await Promise.all([
    runSnapshotCommand("repo-files", "rg", [
      "--files",
      "-g",
      "!node_modules",
      "-g",
      "!.next",
      "-g",
      "!.git",
      "-g",
      "!.env*",
      "-g",
      "!*.tsbuildinfo",
    ]),
    parsed.includeDocs === false
      ? Promise.resolve<Awaited<ReturnType<typeof runSnapshotCommand>>>({
          stdout: "",
          stderr: "",
          metric: {
            name: "docs",
            command: "skipped",
            status: "completed",
            durationMs: 0,
            stdoutBytes: 0,
            stderrBytes: 0,
          },
        })
      : runSnapshotCommand("docs", "rg", ["--files", "docs"]),
    parsed.includeConfig === false
      ? Promise.resolve<Awaited<ReturnType<typeof runSnapshotCommand>>>({
          stdout: "",
          stderr: "",
          metric: {
            name: "config",
            command: "skipped",
            status: "completed",
            durationMs: 0,
            stdoutBytes: 0,
            stderrBytes: 0,
          },
        })
      : runSnapshotCommand("config", "rg", [
          "--files",
          "-g",
          "package.json",
          "-g",
          "pnpm-lock.yaml",
          "-g",
          "*.config.*",
          "-g",
          "*.toml",
          "-g",
          "*.jsonc",
          "-g",
          "Dockerfile*",
          "-g",
          ".dockerignore",
        ]),
    readPackageJson(),
  ]);

  const commandMetrics = [files.metric, docs.metric, configs.metric];
  if (files.metric.status === "unavailable") {
    return {
      ok: false,
      error: repoSnapshotError("repo_snapshot_unavailable", "ripgrep is not available.", false),
    };
  }

  const listFromStdout = (stdout: string, limit: number) =>
    stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !line.startsWith(".env"))
      .slice(0, limit);
  const repoFiles = listFromStdout(files.stdout, 80);
  const docFiles = listFromStdout(docs.stdout, 40);
  const configFiles = listFromStdout(configs.stdout, 40);
  const output: RepoSnapshotOutput = {
    status: "ok",
    summary: `Repository snapshot captured ${repoFiles.length} files, ${docFiles.length} docs, and ${configFiles.length} config files.`,
    packageManager: packageInfo.packageManager,
    scripts: parsed.includeScripts === false ? [] : packageInfo.scripts,
    repoFiles,
    docs: docFiles,
    configFiles,
    signals: [
      ...(packageInfo.packageManager
        ? [
            {
              kind: "package" as const,
              title: "Package manager",
              value: packageInfo.packageManager,
            },
          ]
        : []),
      { kind: "runtime" as const, title: "Runner", value: "fly-langgraph-runtime" },
      ...configFiles.slice(0, 8).map((file) => ({
        kind: "config" as const,
        title: "Config file",
        value: file,
      })),
      ...docFiles
        .slice(0, 8)
        .map((file) => ({ kind: "docs" as const, title: "Doc file", value: file })),
    ],
    commandMetrics,
    timingMs: Date.now() - startedAt,
  };
  return { ok: true, output };
};

const repoSnapshotToolCallId = (runId: string) => `${runId}-tool-repo-snapshot`;
const repoSnapshotArtifactId = (runId: string) => `${runId}-artifact-repo-snapshot`;

const callbackTraceId = (invocation: ToolRunnerInvocation) => {
  if (typeof invocation.callback?.traceId === "string" && invocation.callback.traceId.trim()) {
    return invocation.callback.traceId.trim();
  }
  if (typeof invocation.traceId === "string" && invocation.traceId.trim()) {
    return invocation.traceId.trim();
  }
  return undefined;
};

const repoSnapshotCallbackData = (
  invocation: ToolRunnerInvocation,
  output?: RepoSnapshotOutput,
): Record<string, unknown> => ({
  runner: invocation.runner,
  policyDecisionId:
    typeof invocation.policyDecisionId === "string" ? invocation.policyDecisionId : undefined,
  source: typeof invocation.source === "string" ? invocation.source : undefined,
  timingMs: output?.timingMs,
  commandMetrics: output?.commandMetrics,
  fileCounts: output
    ? {
        repoFiles: output.repoFiles.length,
        docs: output.docs.length,
        configFiles: output.configFiles.length,
      }
    : undefined,
});

const callbackFailure = (
  toolName: string,
  message: string,
  input?: {
    code?: "test_tool_failed" | "runner_callback_signing_not_configured";
    retryable?: boolean;
  },
): RunnerToolResult =>
  toolName === runnerEchoToolName
    ? {
        ok: false,
        error: adminTestToolError(
          input?.code ?? "test_tool_failed",
          message,
          input?.retryable ?? true,
        ),
      }
    : {
        ok: false,
        error: repoSnapshotError(
          input?.code === "runner_callback_signing_not_configured"
            ? "runner_callback_signing_not_configured"
            : "repo_snapshot_failed",
          message,
          input?.retryable ?? true,
        ),
      };

const logCallbackFailure = (
  invocation: ToolRunnerInvocation,
  payload: WorkflowCallbackPayload,
  input: { status: number | string; code: string; message: string },
) => {
  console.warn("runner.callback_failed", {
    component: "langgraph-runtime-gateway",
    event: "runner.callback.failed",
    toolName: typeof invocation.toolName === "string" ? invocation.toolName : undefined,
    runId: payload.runId,
    workflowIntentId: payload.workflowIntentId,
    callbackEvent: payload.event,
    status: input.status,
    code: input.code,
    message: input.message,
  });
};

const postWorkflowCallback = async (
  invocation: ToolRunnerInvocation,
  payload: WorkflowCallbackPayload,
): Promise<{ ok: true } | { ok: false; result: RunnerToolResult; status: number }> => {
  if (!invocation.callback) return { ok: true };
  const toolName = typeof invocation.toolName === "string" ? invocation.toolName : "";
  if (
    invocation.callback.protocolVersion !== "workflow-callback-v0" ||
    typeof invocation.callback.url !== "string" ||
    !invocation.callback.url.trim()
  ) {
    return {
      ok: false,
      status: 400,
      result: callbackFailure(toolName, "Runner callback context is invalid."),
    };
  }

  const secret = process.env.WORKBENCH_CALLBACK_SIGNING_SECRET?.trim();
  if (!secret) {
    const message = "Workbench callback signing is not configured for the runner.";
    logCallbackFailure(invocation, payload, {
      status: 500,
      code: "runner_callback_signing_not_configured",
      message,
    });
    return {
      ok: false,
      status: 500,
      result: callbackFailure(toolName, message, {
        code: "runner_callback_signing_not_configured",
        retryable: false,
      }),
    };
  }

  let callbackUrl: URL;
  try {
    callbackUrl = new URL(invocation.callback.url);
  } catch {
    return {
      ok: false,
      status: 400,
      result: callbackFailure(toolName, "Runner callback URL is invalid."),
    };
  }

  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-assistant-mk1-run-id": payload.runId,
    "x-assistant-mk1-workflow-intent-id": payload.workflowIntentId,
    "x-assistant-mk1-tool-name": toolName,
  };
  Object.assign(
    headers,
    await signFacadeRequest({
      secret,
      method: "POST",
      pathWithQuery: `${callbackUrl.pathname}${callbackUrl.search}`,
      body,
      headers,
    }),
  );

  let response: Response;
  try {
    response = await fetch(callbackUrl, {
      method: "POST",
      headers,
      body,
    });
  } catch {
    logCallbackFailure(invocation, payload, {
      status: "network_error",
      code: "callback_delivery_failed",
      message: `Callback delivery failed for ${payload.event}.`,
    });
    return {
      ok: false,
      status: 502,
      result: callbackFailure(toolName, `Callback delivery failed for ${payload.event}.`),
    };
  }

  if (!response.ok) {
    logCallbackFailure(invocation, payload, {
      status: response.status,
      code: "callback_rejected",
      message: `Callback ${payload.event} was rejected with ${response.status}.`,
    });
    return {
      ok: false,
      status: response.status >= 500 ? 502 : 500,
      result: callbackFailure(
        toolName,
        `Callback ${payload.event} was rejected with ${response.status}.`,
      ),
    };
  }

  return { ok: true };
};

const runnerEchoToolCallId = (runId: string) => `${runId}-tool-runner-echo`;

const runRunnerEcho = (input: unknown): RunnerEchoResult => {
  const parsed = validateRunnerEchoInput(input);
  if ("code" in parsed) return { ok: false, error: parsed };
  const startedAt = Date.now();
  const message = parsed.message ?? "runner echo ok";
  const echoed = parsed.uppercase ? message.toUpperCase() : message;
  const output: RunnerEchoOutput = {
    status: "ok",
    summary: `Runner echo completed: ${echoed}.`,
    message,
    echoed,
    uppercase: parsed.uppercase === true,
    length: echoed.length,
    timingMs: Date.now() - startedAt,
  };
  return { ok: true, output };
};

const runnerEchoCallbackData = (
  invocation: ToolRunnerInvocation,
  output?: RunnerEchoOutput,
): Record<string, unknown> => ({
  runner: invocation.runner,
  policyDecisionId:
    typeof invocation.policyDecisionId === "string" ? invocation.policyDecisionId : undefined,
  source: typeof invocation.source === "string" ? invocation.source : undefined,
  timingMs: output?.timingMs,
  length: output?.length,
});

const emitRepoSnapshotCallback = async (
  invocation: ToolRunnerInvocation,
  payload: Omit<WorkflowCallbackPayload, "runId" | "workflowIntentId" | "traceId">,
) => {
  const runId = typeof invocation.runId === "string" ? invocation.runId : "";
  const workflowIntentId =
    typeof invocation.workflowIntentId === "string" ? invocation.workflowIntentId : "";
  return postWorkflowCallback(invocation, {
    ...payload,
    runId,
    workflowIntentId,
    traceId: callbackTraceId(invocation),
  });
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const stringList = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];

const matchesSandboxPattern = (value: string, pattern: string) => {
  const normalizedValue = value.toLowerCase();
  const normalizedPattern = pattern.trim().toLowerCase();
  if (!normalizedPattern) return false;
  if (normalizedValue === normalizedPattern) return true;
  if (normalizedPattern.startsWith("*."))
    return normalizedValue.endsWith(normalizedPattern.slice(1));
  if (normalizedPattern.startsWith(".")) return normalizedValue.endsWith(normalizedPattern);
  return false;
};

const sandboxEgressError = (runner: ToolRunnerInvocation["runner"], url: URL) => {
  const sandbox = isRecord(runner?.sandbox) ? runner.sandbox : null;
  const network = isRecord(sandbox?.network) ? sandbox.network : null;
  if (!network) {
    return {
      code: "sandbox_required",
      message: "Runner invocation must include a sandbox network policy.",
    };
  }

  const allowedSchemes = stringList(network.allowedSchemes);
  const scheme = url.protocol.replace(":", "").toLowerCase();
  if (allowedSchemes.length > 0 && !allowedSchemes.includes(scheme)) {
    return {
      code: "sandbox_scheme_blocked",
      message: `${scheme} egress is not allowed by the sandbox policy.`,
    };
  }
  if (network.privateNetwork !== "deny") {
    return {
      code: "sandbox_private_network_policy_required",
      message: "Runner sandbox must deny private network egress.",
    };
  }

  const host = url.hostname.toLowerCase();
  const deniedHosts = stringList(network.deniedHosts);
  if (deniedHosts.some((pattern) => matchesSandboxPattern(host, pattern))) {
    return {
      code: "sandbox_egress_denied",
      message: `${host} is denied by the sandbox egress policy.`,
    };
  }

  const allowedHosts = stringList(network.allowedHosts);
  if (
    allowedHosts.length > 0 &&
    !allowedHosts.some((pattern) => matchesSandboxPattern(host, pattern))
  ) {
    return {
      code: "sandbox_egress_not_allowed",
      message: `${host} is not allowed by the sandbox egress policy.`,
    };
  }

  return null;
};

const handleToolRunnerInvocation = async (
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
) => {
  if (request.method !== "POST") {
    json(response, 405, { ok: false, error: "method not allowed" });
    return;
  }

  const body = await readBody(request);
  if (!(await verifyRunnerSignature(request, response, url, body))) return;

  const parsed = parseJsonBuffer<ToolRunnerInvocation>(body);
  if (!parsed || typeof parsed !== "object") {
    json(response, 400, { ok: false, error: "request body must be JSON" });
    return;
  }
  if (
    parsed.toolName !== "url.inspect" &&
    parsed.toolName !== repoSnapshotToolName &&
    parsed.toolName !== runnerEchoToolName
  ) {
    json(response, 400, {
      ok: false,
      error: "unsupported tool",
      details: {
        code: "unsupported_tool",
        message:
          "Only url.inspect, repo.snapshot, and runner.echo are supported by this runner endpoint.",
        retryable: false,
        redacted: true,
      },
    });
    return;
  }

  if (parsed.toolName === runnerEchoToolName) {
    const network = isRecord(parsed.runner?.sandbox) ? parsed.runner.sandbox.network : null;
    if (!isRecord(network) || network.egress !== "none" || network.privateNetwork !== "deny") {
      json(response, 403, {
        ok: false,
        error: {
          code: "sandbox_required",
          message: "runner.echo requires a no-egress sandbox policy.",
          retryable: false,
          redacted: true,
        },
        runner: parsed.runner,
      });
      return;
    }
    const startedAt = Date.now();
    const runId = typeof parsed.runId === "string" ? parsed.runId : "unknown-run";
    const startedCallback = await emitRepoSnapshotCallback(parsed, {
      event: "run.started",
      sequence: 1,
      summary: "runner.echo runner started.",
      toolCall: {
        id: runnerEchoToolCallId(runId),
        toolId: runnerEchoToolName,
        status: "running",
        data: runnerEchoCallbackData(parsed),
      },
    });
    if (!startedCallback.ok) {
      json(response, startedCallback.status, {
        ...startedCallback.result,
        runner: parsed.runner,
        metrics: {
          transport: "fly",
          durationMs: Date.now() - startedAt,
          callback: { status: "failed", event: "run.started" },
        },
      });
      return;
    }

    const result = runRunnerEcho(parsed.input);
    const terminalCallback = await emitRepoSnapshotCallback(
      parsed,
      result.ok
        ? {
            event: "run.completed",
            sequence: 2,
            summary: result.output.summary,
            outputSummary: result.output.summary,
            output: {
              status: result.output.status,
              summary: result.output.summary,
              length: result.output.length,
              timingMs: result.output.timingMs,
            },
            toolCall: {
              id: runnerEchoToolCallId(runId),
              toolId: runnerEchoToolName,
              status: "completed",
              outputSummary: result.output.summary,
              data: runnerEchoCallbackData(parsed, result.output),
            },
          }
        : {
            event: "run.failed",
            sequence: 2,
            summary: result.error.message,
            error: result.error.message,
            toolCall: {
              id: runnerEchoToolCallId(runId),
              toolId: runnerEchoToolName,
              status: "failed",
              outputSummary: result.error.message,
              data: {
                ...runnerEchoCallbackData(parsed),
                errorCode: result.error.code,
              },
            },
          },
    );
    if (!terminalCallback.ok) {
      json(response, terminalCallback.status, {
        ...terminalCallback.result,
        runner: parsed.runner,
        metrics: {
          transport: "fly",
          durationMs: Date.now() - startedAt,
          callback: {
            status: "failed",
            event: result.ok ? "run.completed" : "run.failed",
          },
        },
      });
      return;
    }

    json(response, result.ok ? 200 : 502, {
      ...result,
      runner: parsed.runner,
      metrics: {
        transport: "fly",
        durationMs: Date.now() - startedAt,
        callback: parsed.callback ? { status: "completed" } : { status: "skipped" },
      },
    });
    return;
  }

  if (parsed.toolName === repoSnapshotToolName) {
    const network = isRecord(parsed.runner?.sandbox) ? parsed.runner.sandbox.network : null;
    if (!isRecord(network) || network.egress !== "none" || network.privateNetwork !== "deny") {
      json(response, 403, {
        ok: false,
        error: {
          code: "sandbox_required",
          message: "repo.snapshot requires a no-egress sandbox policy.",
          retryable: false,
          redacted: true,
        },
        runner: parsed.runner,
      });
      return;
    }
    const startedAt = Date.now();
    const startedCallback = await emitRepoSnapshotCallback(parsed, {
      event: "run.started",
      sequence: 1,
      summary: "repo.snapshot runner started.",
      toolCall: {
        id: repoSnapshotToolCallId(typeof parsed.runId === "string" ? parsed.runId : "unknown-run"),
        toolId: repoSnapshotToolName,
        status: "running",
        data: repoSnapshotCallbackData(parsed),
      },
    });
    if (!startedCallback.ok) {
      json(response, startedCallback.status, {
        ...startedCallback.result,
        runner: parsed.runner,
        metrics: {
          transport: "fly",
          durationMs: Date.now() - startedAt,
          callback: { status: "failed", event: "run.started" },
        },
      });
      return;
    }

    if (e2eRunnerDelayMs > 0) await delay(e2eRunnerDelayMs);

    const result = await runRepoSnapshot(parsed.input);
    const runId = typeof parsed.runId === "string" ? parsed.runId : "unknown-run";
    const artifactRef = result.ok
      ? {
          id: repoSnapshotArtifactId(runId),
          kind: "report",
          uri: `d1://control-plane/${runId}/repo-snapshot-report.json`,
          title: "Repository snapshot report",
          mimeType: "application/json",
          sizeBytes: JSON.stringify(result.output).length,
          data: {
            ...repoSnapshotCallbackData(parsed, result.output),
            outputSummary: result.output.summary,
          },
        }
      : null;

    if (result.ok && artifactRef) {
      const artifactCallback = await emitRepoSnapshotCallback(parsed, {
        event: "artifact.created",
        sequence: 2,
        summary: "Created repository snapshot artifact metadata.",
        artifact: artifactRef,
        toolCall: {
          id: repoSnapshotToolCallId(runId),
          toolId: repoSnapshotToolName,
          status: "running",
          artifactRefs: [
            {
              id: artifactRef.id,
              kind: artifactRef.kind,
              uri: artifactRef.uri,
              title: artifactRef.title,
              mimeType: artifactRef.mimeType,
            },
          ],
          data: repoSnapshotCallbackData(parsed, result.output),
        },
      });
      if (!artifactCallback.ok) {
        json(response, artifactCallback.status, {
          ...artifactCallback.result,
          runner: parsed.runner,
          metrics: {
            transport: "fly",
            durationMs: Date.now() - startedAt,
            callback: { status: "failed", event: "artifact.created" },
          },
        });
        return;
      }
    }

    const terminalCallback = await emitRepoSnapshotCallback(
      parsed,
      result.ok
        ? {
            event: "run.completed",
            sequence: 3,
            summary: result.output.summary,
            outputSummary: result.output.summary,
            output: {
              status: result.output.status,
              summary: result.output.summary,
              packageManager: result.output.packageManager,
              timingMs: result.output.timingMs,
              commandMetrics: result.output.commandMetrics,
              fileCounts: {
                repoFiles: result.output.repoFiles.length,
                docs: result.output.docs.length,
                configFiles: result.output.configFiles.length,
              },
            },
            toolCall: {
              id: repoSnapshotToolCallId(runId),
              toolId: repoSnapshotToolName,
              status: "completed",
              outputSummary: result.output.summary,
              artifactRefs: artifactRef
                ? [
                    {
                      id: artifactRef.id,
                      kind: artifactRef.kind,
                      uri: artifactRef.uri,
                      title: artifactRef.title,
                      mimeType: artifactRef.mimeType,
                    },
                  ]
                : [],
              data: repoSnapshotCallbackData(parsed, result.output),
            },
          }
        : {
            event: "run.failed",
            sequence: 3,
            summary: result.error.message,
            error: result.error.message,
            toolCall: {
              id: repoSnapshotToolCallId(runId),
              toolId: repoSnapshotToolName,
              status: "failed",
              outputSummary: result.error.message,
              data: {
                ...repoSnapshotCallbackData(parsed),
                errorCode: result.error.code,
              },
            },
          },
    );
    if (!terminalCallback.ok) {
      json(response, terminalCallback.status, {
        ...terminalCallback.result,
        runner: parsed.runner,
        metrics: {
          transport: "fly",
          durationMs: Date.now() - startedAt,
          callback: {
            status: "failed",
            event: result.ok ? "run.completed" : "run.failed",
          },
        },
      });
      return;
    }

    json(response, result.ok ? 200 : 502, {
      ...result,
      runner: parsed.runner,
      metrics: {
        transport: "fly",
        durationMs: Date.now() - startedAt,
        callback: parsed.callback ? { status: "completed" } : { status: "skipped" },
      },
    });
    return;
  }

  const validated = validateUrlInspectInput(parsed.input);
  if (!validated.ok) {
    json(response, validated.status, {
      ok: false,
      error: validated.error,
      runner: parsed.runner,
    });
    return;
  }

  const sandboxError = sandboxEgressError(parsed.runner, validated.url);
  if (sandboxError) {
    json(response, 403, {
      ok: false,
      error: {
        ...sandboxError,
        retryable: false,
        redacted: true,
      },
      runner: parsed.runner,
    });
    return;
  }

  const startedAt = Date.now();
  const sandbox = isRecord(parsed.runner?.sandbox) ? parsed.runner.sandbox : null;
  const network = isRecord(sandbox?.network) ? sandbox.network : null;
  const result = await inspectPublicUrl(validated.url, {
    allowedHosts: stringList(network?.allowedHosts),
    deniedHosts: stringList(network?.deniedHosts),
  });
  json(response, result.ok ? 200 : 502, {
    ...result,
    runner: parsed.runner,
    metrics: {
      transport: "fly",
      durationMs: Date.now() - startedAt,
    },
  });
};

const headersToForward = (request: IncomingMessage) => {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (!value || key === "host" || key === "content-length") continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.set(key, value);
    }
  }
  headers.delete("x-api-key");
  headers.delete("authorization");
  return headers;
};

const proxyToLangGraph = async (request: IncomingMessage, response: ServerResponse, url: URL) => {
  if (!requireProxyAuth(request, response)) return;

  const method = request.method ?? "GET";
  const body = ["GET", "HEAD"].includes(method) ? undefined : await readBody(request);
  const upstreamResponse = await fetch(`${langGraphUpstreamUrl}${url.pathname}${url.search}`, {
    method,
    headers: headersToForward(request),
    body,
  });

  const responseHeaders = new Headers(upstreamResponse.headers);
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");
  responseHeaders.delete("transfer-encoding");

  response.writeHead(upstreamResponse.status, Object.fromEntries(responseHeaders.entries()));
  if (upstreamResponse.body) {
    Readable.fromWeb(upstreamResponse.body as unknown as NodeReadableStream).pipe(response);
    return;
  }
  response.end();
};

const server = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (request.method === "GET" && url.pathname === "/health/live") {
      json(response, 200, {
        ok: true,
        service: "assistant-mk1-langgraph-runtime",
        gatewayReady: true,
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/health") {
      const langGraphReady = await isLangGraphReady();
      json(response, langGraphReady ? 200 : 503, {
        ok: langGraphReady,
        service: "assistant-mk1-langgraph-runtime",
        langGraphReady,
      });
      return;
    }

    if (url.pathname === "/workbench/executors/demo-inspect") {
      await handleDemoInspectExecutor(request, response);
      return;
    }

    if (url.pathname === runnerInvocationPath) {
      await handleToolRunnerInvocation(request, response, url);
      return;
    }

    await proxyToLangGraph(request, response, url);
  })().catch((error: unknown) => {
    json(response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : "runtime gateway request failed",
    });
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`LangGraph runtime gateway listening on ${port}`);
});
