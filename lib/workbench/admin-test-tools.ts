export const diagnosticPingToolName = "diagnostic.ping";
export const runnerEchoToolName = "runner.echo";
export const artifactMetadataTestToolName = "artifact.metadata.test";

export const diagnosticPingPolicy = "admin-conformance-diagnostic-ping-v0";
export const runnerEchoPolicy = "admin-conformance-runner-echo-v0";
export const artifactMetadataTestPolicy = "admin-conformance-artifact-metadata-v0";
export const runnerEchoAdapterVersion = "runner-echo-v1";

export type AdminTestToolName =
  | typeof diagnosticPingToolName
  | typeof runnerEchoToolName
  | typeof artifactMetadataTestToolName;

export type AdminTestToolError = {
  code:
    | "invalid_input"
    | "test_tool_failed"
    | "runner_request_failed"
    | "runner_callback_signing_not_configured";
  message: string;
  retryable: boolean;
  redacted: true;
};

export type DiagnosticPingInput = {
  label?: string;
};

export type RunnerEchoInput = {
  message?: string;
  uppercase?: boolean;
};

export type ArtifactMetadataTestInput = {
  label?: string;
};

export type DiagnosticPingOutput = {
  status: "ok";
  summary: string;
  label?: string;
  checkedAt: string;
};

export type RunnerEchoOutput = {
  status: "ok";
  summary: string;
  message: string;
  echoed: string;
  uppercase: boolean;
  length: number;
  timingMs: number;
};

export type ArtifactMetadataTestOutput = {
  status: "ok";
  summary: string;
  label?: string;
  artifact: {
    kind: "report";
    title: string;
    mimeType: "application/json";
  };
};

export type DiagnosticPingResult =
  | { ok: true; output: DiagnosticPingOutput }
  | { ok: false; error: AdminTestToolError };

export type RunnerEchoResult =
  | { ok: true; output: RunnerEchoOutput }
  | { ok: false; error: AdminTestToolError };

export type ArtifactMetadataTestResult =
  | { ok: true; output: ArtifactMetadataTestOutput }
  | { ok: false; error: AdminTestToolError };

export type AdminTestToolResult =
  | DiagnosticPingResult
  | RunnerEchoResult
  | ArtifactMetadataTestResult;

export const adminTestToolError = (
  code: AdminTestToolError["code"],
  message: string,
  retryable = false,
): AdminTestToolError => ({ code, message, retryable, redacted: true });

const supportedInputKeys = {
  [diagnosticPingToolName]: new Set(["label"]),
  [runnerEchoToolName]: new Set(["message", "uppercase"]),
  [artifactMetadataTestToolName]: new Set(["label"]),
};

const forbiddenInputKeys = new Set([
  "command",
  "path",
  "url",
  "prompt",
  "messageLog",
  "logs",
  "stdout",
  "stderr",
  "token",
  "secret",
  "password",
  "apiKey",
  "api_key",
]);

const boundedString = (value: unknown, field: string, maxLength: number) => {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    return adminTestToolError("invalid_input", `${field} must be a string when provided.`);
  }
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > maxLength) {
    return adminTestToolError("invalid_input", `${field} must be ${maxLength} characters or less.`);
  }
  return trimmed;
};

const isAdminTestToolError = (value: unknown): value is AdminTestToolError =>
  typeof value === "object" && value !== null && "code" in value;

const readInputRecord = (
  toolName: AdminTestToolName,
  input: unknown,
): Record<string, unknown> | AdminTestToolError => {
  if (input === undefined || input === null) return {};
  if (typeof input !== "object" || Array.isArray(input)) {
    return adminTestToolError("invalid_input", `${toolName} input must be an object.`);
  }

  const source = input as Record<string, unknown>;
  const supported = supportedInputKeys[toolName];
  for (const key of Object.keys(source)) {
    if (forbiddenInputKeys.has(key) || !supported.has(key)) {
      return adminTestToolError("invalid_input", `${key} is not supported by ${toolName}.`);
    }
  }
  return source;
};

export const validateDiagnosticPingInput = (
  input: unknown,
): DiagnosticPingInput | AdminTestToolError => {
  const source = readInputRecord(diagnosticPingToolName, input);
  if ("code" in source) return source;
  const label = boundedString(source.label, "label", 80);
  if (isAdminTestToolError(label)) return label;
  return label ? { label } : {};
};

export const validateRunnerEchoInput = (input: unknown): RunnerEchoInput | AdminTestToolError => {
  const source = readInputRecord(runnerEchoToolName, input);
  if ("code" in source) return source;
  const message = boundedString(source.message, "message", 160);
  if (isAdminTestToolError(message)) return message;
  if (source.uppercase !== undefined && typeof source.uppercase !== "boolean") {
    return adminTestToolError("invalid_input", "uppercase must be a boolean when provided.");
  }
  return {
    message: message ?? "runner echo ok",
    uppercase: source.uppercase === true,
  };
};

export const validateArtifactMetadataTestInput = (
  input: unknown,
): ArtifactMetadataTestInput | AdminTestToolError => {
  const source = readInputRecord(artifactMetadataTestToolName, input);
  if ("code" in source) return source;
  const label = boundedString(source.label, "label", 80);
  if (isAdminTestToolError(label)) return label;
  return label ? { label } : {};
};
