"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  FileTextIcon,
  HistoryIcon,
  Loader2Icon,
  RefreshCwIcon,
  SearchIcon,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  EmptyPanelText,
  StatusPill,
  StatusRow,
} from "@/components/workbench/dev-monitor-primitives";
import type {
  ArtifactSummary,
  CloudflareArtifactHistoryResponse,
  CloudflareExecutionHistoryResponse,
  CloudflareExecutionHistoryRunResponse,
  CloudflareOwnedDemoRunSnapshot,
  ExecutionHistoryRunSummary,
} from "@/lib/workbench/workbench-types";

const historyRunsPath = "/api/workbench/history/runs";
const historyArtifactsPath = "/api/workbench/history/artifacts";

const readJsonResponse = async <T,>(response: Response, fallback: string): Promise<T> => {
  const body = (await response.json().catch(() => ({}))) as T & { error?: unknown };
  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? body.error : fallback);
  }
  return body;
};

const runHistoryTitle = (run: ExecutionHistoryRunSummary) =>
  run.displayName ?? run.summary ?? run.id;

const formatAge = (value?: string) => {
  if (!value) return "time unknown";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "time unknown";

  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
};

const formatBytes = (value?: number) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
};

const summaryDetail = (run: ExecutionHistoryRunSummary) =>
  [
    run.stage ?? "unknown stage",
    run.engine ?? "unknown engine",
    `${run.toolCallCount ?? 0} tool calls`,
  ].join(" / ");

export function WorkbenchHistoryPanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [runs, setRuns] = useState<ExecutionHistoryRunSummary[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedRunSnapshot, setSelectedRunSnapshot] =
    useState<CloudflareOwnedDemoRunSnapshot | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isLoadingRun, setIsLoadingRun] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) ?? null,
    [runs, selectedRunId],
  );
  const latestArtifact = artifacts.at(0) ?? null;

  const loadHistory = useCallback(async () => {
    setIsLoadingHistory(true);
    setHistoryError(null);
    try {
      const [runsResponse, artifactsResponse] = await Promise.all([
        fetch(`${historyRunsPath}?limit=20`, { cache: "no-store" }),
        fetch(`${historyArtifactsPath}?limit=20`, { cache: "no-store" }),
      ]);
      const [runsBody, artifactsBody] = await Promise.all([
        readJsonResponse<CloudflareExecutionHistoryResponse>(
          runsResponse,
          "Failed to load execution history",
        ),
        readJsonResponse<CloudflareArtifactHistoryResponse>(
          artifactsResponse,
          "Failed to load artifact history",
        ),
      ]);
      setRuns(runsBody.runs ?? []);
      setArtifacts(artifactsBody.artifacts ?? []);
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : "Failed to load history");
    } finally {
      setIsLoadingHistory(false);
    }
  }, []);

  const inspectRun = useCallback(async (runId: string) => {
    setSelectedRunId(runId);
    setSelectedRunSnapshot(null);
    setIsLoadingRun(true);
    setRunError(null);
    try {
      const response = await fetch(`${historyRunsPath}/${encodeURIComponent(runId)}`, {
        cache: "no-store",
      });
      const body = await readJsonResponse<CloudflareExecutionHistoryRunResponse>(
        response,
        "Failed to load run details",
      );
      setSelectedRunSnapshot(body.snapshot ?? null);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "Failed to load run details");
    } finally {
      setIsLoadingRun(false);
    }
  }, []);

  useEffect(() => {
    if (open) void loadHistory();
  }, [loadHistory, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-0 right-0 left-auto flex h-dvh max-h-dvh w-full max-w-xl translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-y-0 border-r-0 p-0 sm:max-w-xl">
        <DialogHeader className="border-border border-b px-5 py-4">
          <div className="flex items-start justify-between gap-4 pr-8">
            <span>
              <DialogTitle className="flex items-center gap-2 text-base">
                <HistoryIcon className="text-muted-foreground size-4" />
                Workbench History
              </DialogTitle>
              <DialogDescription>
                Scoped workflow runs, tool calls, and artifact metadata for this workspace.
              </DialogDescription>
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void loadHistory()}
              disabled={isLoadingHistory}
            >
              {isLoadingHistory ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
              Refresh
            </Button>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
            <StatusRow
              label="Recent runs"
              value={isLoadingHistory ? "Loading" : String(runs.length)}
              compact
              tone={runs.length ? "ok" : "muted"}
            />
            <StatusRow
              label="Artifacts"
              value={isLoadingHistory ? "Loading" : String(artifacts.length)}
              compact
              tone={artifacts.length ? "ok" : "muted"}
            />
            <StatusRow
              label="Selected"
              value={selectedRun ? runHistoryTitle(selectedRun) : "No run selected"}
              compact
            />
            <StatusRow
              label="Latest artifact"
              value={latestArtifact?.title ?? "None"}
              compact
              tone={latestArtifact ? "ok" : "muted"}
            />
          </div>

          {historyError ? (
            <div className="border-destructive/30 bg-destructive/10 mt-4 rounded-md border p-3 text-sm">
              <p className="text-destructive font-medium">{historyError}</p>
              <p className="text-muted-foreground mt-1 text-xs">
                The chat thread can keep running while history reloads.
              </p>
            </div>
          ) : null}

          <HistorySection icon={HistoryIcon} title="Recent Runs">
            {isLoadingHistory && !runs.length ? (
              <EmptyPanelText>Loading execution history.</EmptyPanelText>
            ) : runs.length ? (
              <ol className="space-y-2">
                {runs.map((run) => (
                  <li key={run.id} className="border-border rounded-md border p-3 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{runHistoryTitle(run)}</span>
                        <span className="text-muted-foreground block text-xs">
                          {summaryDetail(run)}
                        </span>
                        <span className="text-muted-foreground/80 block text-xs">
                          {formatAge(run.updatedAt ?? run.createdAt)}
                        </span>
                        {run.artifactIds?.length ? (
                          <span className="text-muted-foreground block text-xs">
                            {run.artifactIds.length} artifacts
                          </span>
                        ) : null}
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-2">
                        <StatusPill status={run.status ?? "unknown"} tone={run.status} />
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={isLoadingRun && selectedRunId === run.id}
                          onClick={() => void inspectRun(run.id)}
                        >
                          {isLoadingRun && selectedRunId === run.id ? (
                            <Loader2Icon className="animate-spin" />
                          ) : (
                            <SearchIcon />
                          )}
                          Inspect
                        </Button>
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyPanelText>
                Run a tool, callback, or workflow to populate execution history.
              </EmptyPanelText>
            )}
          </HistorySection>

          <HistorySection icon={FileTextIcon} title="Artifacts">
            {isLoadingHistory && !artifacts.length ? (
              <EmptyPanelText>Loading artifact metadata.</EmptyPanelText>
            ) : artifacts.length ? (
              <ol className="space-y-2">
                {artifacts.map((artifact) => (
                  <li key={artifact.id} className="border-border rounded-md border p-3 text-sm">
                    <p className="truncate font-medium">{artifact.title ?? "Metadata artifact"}</p>
                    <p className="text-muted-foreground text-xs">
                      {artifact.kind ?? "artifact"} / {artifact.mimeType ?? "metadata"} /{" "}
                      {formatBytes(artifact.sizeBytes) ?? "size unknown"}
                    </p>
                    <p className="text-muted-foreground/80 text-xs">
                      {formatAge(artifact.createdAt)}
                    </p>
                    <p className="text-muted-foreground mt-2 break-all text-xs">
                      {artifact.uri ?? "metadata-only artifact"}
                    </p>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyPanelText>
                Metadata artifacts will appear after tools or callbacks create them.
              </EmptyPanelText>
            )}
          </HistorySection>

          <HistorySection icon={SearchIcon} title="Selected Run">
            {!selectedRunId ? (
              <EmptyPanelText>Select a run to inspect its stored summary.</EmptyPanelText>
            ) : isLoadingRun ? (
              <EmptyPanelText>Loading run details.</EmptyPanelText>
            ) : runError ? (
              <div className="border-destructive/30 bg-destructive/10 rounded-md border p-3 text-sm">
                <p className="text-destructive font-medium">{runError}</p>
              </div>
            ) : selectedRunSnapshot ? (
              <SelectedRunSummary snapshot={selectedRunSnapshot} />
            ) : (
              <EmptyPanelText>No details returned for this run.</EmptyPanelText>
            )}
          </HistorySection>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function HistorySection({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-5">
      <div className="mb-2 flex items-center gap-2">
        <Icon className="text-muted-foreground size-4" />
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function SelectedRunSummary({ snapshot }: { snapshot: CloudflareOwnedDemoRunSnapshot }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <StatusRow label="Status" value={snapshot.run?.status} compact />
        <StatusRow label="Intent" value={snapshot.intent?.type} compact />
        <StatusRow label="Stage" value={snapshot.run?.stage ?? snapshot.intent?.stage} compact />
        <StatusRow label="Tool calls" value={String(snapshot.toolCalls.length)} compact />
      </div>

      <SummaryList
        title="Tool calls"
        empty="No tool calls attached to this run."
        items={snapshot.toolCalls.slice(0, 6).map((toolCall) => ({
          key: toolCall.id,
          title: toolCall.toolId ?? "Unknown tool",
          detail: toolCall.outputSummary ?? toolCall.inputSummary ?? "Tool call recorded.",
          status: toolCall.status,
        }))}
      />
      <SummaryList
        title="Artifacts"
        empty="No artifacts attached to this run."
        items={snapshot.artifacts.slice(0, 6).map((artifact) => ({
          key: artifact.id,
          title: artifact.title ?? "Metadata artifact",
          detail: artifact.uri ?? "metadata-only artifact",
        }))}
      />
      <SummaryList
        title="Decisions"
        empty="No decisions attached to this run."
        items={snapshot.decisions.slice(0, 6).map((decision) => ({
          key: decision.id,
          title: decision.title ?? "Decision",
          detail: decision.summary ?? decision.thesis ?? "Decision recorded.",
        }))}
      />
      <SummaryList
        title="Child runs"
        empty="No child runs attached to this run."
        items={(snapshot.childRuns ?? []).slice(0, 6).map((childRun, index) => ({
          key: childRun.id ?? `child-${index}`,
          title: childRun.stage ?? "Child run",
          detail: `${childRun.engine ?? "unknown engine"} / ${formatAge(
            childRun.updatedAt ?? childRun.createdAt,
          )}`,
          status: childRun.status,
        }))}
      />
      <SummaryList
        title="Audit"
        empty="No audit events attached to this run."
        items={snapshot.auditEvents.slice(0, 6).map((event) => ({
          key: event.id,
          title: event.action ?? "Audit event",
          detail: event.summary ?? "Audit event recorded.",
        }))}
      />
    </div>
  );
}

function SummaryList({
  title,
  empty,
  items,
}: {
  title: string;
  empty: string;
  items: Array<{ key: string; title: string; detail?: string; status?: string }>;
}) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold">{title}</h3>
      {items.length ? (
        <ol className="space-y-2">
          {items.map((item) => (
            <li key={item.key} className="border-border rounded-md border p-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{item.title}</span>
                  {item.detail ? (
                    <span className="text-muted-foreground mt-1 block text-xs">{item.detail}</span>
                  ) : null}
                </span>
                {item.status ? <StatusPill status={item.status} tone={item.status} /> : null}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyPanelText>{empty}</EmptyPanelText>
      )}
    </div>
  );
}
