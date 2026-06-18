export type RepoSnapshotInput = {
  includeDocs?: boolean;
  includeScripts?: boolean;
  includeConfig?: boolean;
};

export type RepoSnapshotError = {
  code:
    | "invalid_input"
    | "repo_snapshot_failed"
    | "repo_snapshot_timeout"
    | "repo_snapshot_unavailable";
  message: string;
  retryable: boolean;
  redacted: true;
};

export type RepoSnapshotCommandMetric = {
  name: string;
  command: string;
  status: "completed" | "failed" | "timeout" | "unavailable";
  durationMs: number;
  exitCode?: number;
  stdoutBytes: number;
  stderrBytes: number;
};

export type RepoSnapshotOutput = {
  status: "ok";
  summary: string;
  packageManager?: string;
  scripts: string[];
  repoFiles: string[];
  docs: string[];
  configFiles: string[];
  signals: Array<{
    kind: "package" | "docs" | "config" | "runtime";
    title: string;
    value: string;
  }>;
  commandMetrics: RepoSnapshotCommandMetric[];
  timingMs: number;
};

export type RepoSnapshotResult =
  | { ok: true; output: RepoSnapshotOutput }
  | { ok: false; error: RepoSnapshotError };

export const repoSnapshotToolName = "repo.snapshot";
export const repoSnapshotPolicy = "repo-snapshot-readonly-v0";
export const repoSnapshotAdapterVersion = "repo-snapshot-v1";

export const repoSnapshotError = (
  code: RepoSnapshotError["code"],
  message: string,
  retryable = false,
): RepoSnapshotError => ({ code, message, retryable, redacted: true });

export const validateRepoSnapshotInput = (
  input: unknown,
): RepoSnapshotInput | RepoSnapshotError => {
  if (input === undefined || input === null) return {};
  if (typeof input !== "object" || Array.isArray(input)) {
    return repoSnapshotError("invalid_input", "repo.snapshot input must be an object.", false);
  }

  const source = input as Record<string, unknown>;
  const supportedKeys = new Set(["includeDocs", "includeScripts", "includeConfig"]);
  for (const key of Object.keys(source)) {
    if (!supportedKeys.has(key)) {
      return repoSnapshotError(
        "invalid_input",
        `${key} is not a supported repo.snapshot option.`,
        false,
      );
    }
  }

  const output: RepoSnapshotInput = {};
  for (const key of ["includeDocs", "includeScripts", "includeConfig"] as const) {
    if (source[key] === undefined) continue;
    if (typeof source[key] !== "boolean") {
      return repoSnapshotError("invalid_input", `${key} must be a boolean when provided.`, false);
    }
    output[key] = source[key];
  }
  return output;
};
