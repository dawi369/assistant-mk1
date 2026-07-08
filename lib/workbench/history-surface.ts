import type {
  ArtifactSummary,
  CloudflareOwnedDemoRunSnapshot,
  ExecutionHistoryRunSummary,
} from "./workbench-types";

export type HistoryFocusRequest = {
  runId?: string;
  artifactId?: string;
  label?: string;
  createdAt: number;
};

export type HistoryFilter = "all" | "workflows" | "tools" | "artifacts" | "failed";

export type ArtifactPreview = {
  title: string;
  lines: string[];
  json?: string;
};

export const historyFilters: Array<{ id: HistoryFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "workflows", label: "Workflows" },
  { id: "tools", label: "Tools" },
  { id: "artifacts", label: "Artifacts" },
  { id: "failed", label: "Failed" },
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const firstString = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
};

export const isWorkflowRun = (
  run: Pick<ExecutionHistoryRunSummary, "workflowIntentId" | "stage">,
) => Boolean(run.workflowIntentId) || Boolean(run.stage && run.stage !== "observe");

export const isFailedRun = (run: Pick<ExecutionHistoryRunSummary, "status">) =>
  run.status === "failed" || run.status === "cancelled";

export const isArtifactLinkedRun = (run: Pick<ExecutionHistoryRunSummary, "artifactIds">) =>
  Boolean(run.artifactIds?.length);

export const isToolOnlyRun = (
  run: Pick<ExecutionHistoryRunSummary, "workflowIntentId" | "stage" | "toolCallCount">,
) => !isWorkflowRun(run) && Boolean(run.toolCallCount && run.toolCallCount > 0);

export const filterHistoryRuns = (
  runs: ExecutionHistoryRunSummary[],
  filter: HistoryFilter,
): ExecutionHistoryRunSummary[] => {
  if (filter === "workflows") return runs.filter(isWorkflowRun);
  if (filter === "tools") return runs.filter(isToolOnlyRun);
  if (filter === "artifacts") return runs.filter(isArtifactLinkedRun);
  if (filter === "failed") return runs.filter(isFailedRun);
  return runs;
};

export const resolveFocusedRunId = (
  runs: ExecutionHistoryRunSummary[],
  focus?: HistoryFocusRequest | null,
): string | null => {
  if (!focus) return runs[0]?.id ?? null;
  if (focus.runId && runs.some((run) => run.id === focus.runId)) return focus.runId;
  if (focus.artifactId) {
    const run = runs.find((item) => item.artifactIds?.includes(focus.artifactId ?? ""));
    if (run) return run.id;
  }
  return runs[0]?.id ?? null;
};

export const isOpenableArtifactUri = (uri?: string | null) => {
  if (!uri) return false;
  try {
    const parsed = new URL(uri);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

export const buildArtifactPreview = (
  artifact: ArtifactSummary | CloudflareOwnedDemoRunSnapshot["artifacts"][number],
): ArtifactPreview => {
  const data = "data" in artifact ? artifact.data : undefined;
  const title = artifact.title ?? artifact.id ?? "Artifact";
  const lines: string[] = [];

  if (isRecord(data)) {
    const summary = firstString(data.summary, data.outputSummary, data.description);
    const report = firstString(data.report, data.markdown, data.text, data.content);
    const uri = firstString(artifact.uri);
    if (summary) lines.push(summary);
    if (report && report !== summary) lines.push(report);
    if (uri) lines.push(uri);
    return {
      title,
      lines: lines.length ? lines : ["Metadata artifact."],
      json: JSON.stringify(data, null, 2),
    };
  }

  if (artifact.uri) lines.push(artifact.uri);
  if (artifact.mimeType) lines.push(artifact.mimeType);
  return {
    title,
    lines: lines.length ? lines : ["Metadata artifact."],
  };
};
