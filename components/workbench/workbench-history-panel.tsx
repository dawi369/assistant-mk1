"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CheckIcon,
  CircleStopIcon,
  ClipboardIcon,
  ExternalLinkIcon,
  FileTextIcon,
  HistoryIcon,
  Loader2Icon,
  RefreshCwIcon,
  RotateCcwIcon,
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
  CopyId,
  EmptyPanelText,
  StatusPill,
  StatusRow,
} from "@/components/workbench/dev-monitor-primitives";
import {
  buildArtifactPreview,
  countHistoryRuns,
  filterHistoryRuns,
  historyFilters,
  isOpenableArtifactUri,
  resolveFocusedRunId,
  searchHistoryRuns,
  type HistoryFilter,
  type HistoryFocusRequest,
} from "@/lib/workbench/history-surface";
import { cn } from "@/lib/utils";
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
  focus,
  onOpenChange,
  onCloseAutoFocus,
  onFocusConsumed,
}: {
  open: boolean;
  focus?: HistoryFocusRequest | null;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
  onFocusConsumed?: () => void;
}) {
  const [runs, setRuns] = useState<ExecutionHistoryRunSummary[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedRunSnapshot, setSelectedRunSnapshot] =
    useState<CloudflareOwnedDemoRunSnapshot | null>(null);
  const [activeFilter, setActiveFilter] = useState<HistoryFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightedRunId, setHighlightedRunId] = useState<string | null>(null);
  const [highlightedArtifactId, setHighlightedArtifactId] = useState<string | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isLoadingRun, setIsLoadingRun] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const selectedRunIdRef = useRef<string | null>(null);

  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) ?? null,
    [runs, selectedRunId],
  );
  const searchedRuns = useMemo(() => searchHistoryRuns(runs, searchQuery), [runs, searchQuery]);
  const filteredSearchedRuns = useMemo(
    () => filterHistoryRuns(searchedRuns, activeFilter),
    [activeFilter, searchedRuns],
  );
  const filterCounts = useMemo(() => countHistoryRuns(searchedRuns), [searchedRuns]);
  const selectedRunArtifacts = useMemo(() => {
    if (!selectedRun?.artifactIds?.length) return [];
    const artifactIds = new Set(selectedRun.artifactIds);
    return artifacts.filter((artifact) => artifactIds.has(artifact.id));
  }, [artifacts, selectedRun?.artifactIds]);

  useEffect(() => {
    selectedRunIdRef.current = selectedRunId;
  }, [selectedRunId]);

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
      const nextRuns = runsBody.runs ?? [];
      const nextArtifacts = artifactsBody.artifacts ?? [];
      setRuns(nextRuns);
      setArtifacts(nextArtifacts);
      return { runs: nextRuns, artifacts: nextArtifacts };
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : "Failed to load history");
      return null;
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

  const performRunAction = useCallback(
    async (action: "cancel" | "retry") => {
      if (!selectedRunId) return;
      setBusyAction(action);
      setRunError(null);
      try {
        await fetch(`${historyRunsPath}/${encodeURIComponent(selectedRunId)}/${action}`, {
          method: "POST",
        }).then((response) => readJsonResponse(response, `Failed to ${action} run`));
        const loaded = await loadHistory();
        const nextRunId =
          action === "retry" ? (loaded?.runs[0]?.id ?? selectedRunId) : selectedRunId;
        await inspectRun(nextRunId);
      } catch (actionError) {
        setRunError(actionError instanceof Error ? actionError.message : `Failed to ${action} run`);
      } finally {
        setBusyAction(null);
      }
    },
    [inspectRun, loadHistory, selectedRunId],
  );

  const decideApproval = useCallback(
    async (approvalId: string, action: "approve" | "deny") => {
      setBusyAction(`${action}:${approvalId}`);
      setRunError(null);
      try {
        await fetch(`/api/workbench/tools/approvals/${encodeURIComponent(approvalId)}/${action}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: action === "deny" ? JSON.stringify({ reason: "Denied from History" }) : undefined,
        }).then((response) => readJsonResponse(response, `Failed to ${action} approval`));
        await loadHistory();
        if (selectedRunId) await inspectRun(selectedRunId);
      } catch (approvalError) {
        setRunError(
          approvalError instanceof Error ? approvalError.message : `Failed to ${action} approval`,
        );
      } finally {
        setBusyAction(null);
      }
    },
    [inspectRun, loadHistory, selectedRunId],
  );

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    const refresh = async () => {
      const loaded = await loadHistory();
      if (cancelled || !loaded) return;

      const runId = focus
        ? resolveFocusedRunId(loaded.runs, focus)
        : (selectedRunIdRef.current ?? loaded.runs[0]?.id ?? null);
      if (runId) {
        setHighlightedRunId(focus ? runId : null);
        void inspectRun(runId);
      }

      setHighlightedArtifactId(focus?.artifactId ?? null);
      if (focus) onFocusConsumed?.();
    };

    void refresh();
    return () => {
      cancelled = true;
    };
  }, [focus, inspectRun, loadHistory, onFocusConsumed, open]);

  const closeFromOverlay = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="top-0 right-0 left-auto flex h-dvh max-h-dvh w-full max-w-xl translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-y-0 border-r-0 p-0 sm:max-w-xl"
        onCloseAutoFocus={onCloseAutoFocus}
        onOverlayMouseDown={closeFromOverlay}
        onOverlayPointerDown={closeFromOverlay}
        onOverlayTouchStart={closeFromOverlay}
      >
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
              label="Visible"
              value={isLoadingHistory ? "Loading" : String(filteredSearchedRuns.length)}
              compact
              tone={filteredSearchedRuns.length ? "ok" : "muted"}
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
            <label className="relative mb-3 block">
              <SearchIcon className="text-muted-foreground pointer-events-none absolute top-2.5 left-2.5 size-4" />
              <input
                type="search"
                className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring h-9 w-full rounded-md border pr-3 pl-8 text-sm outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                value={searchQuery}
                placeholder="Search runs, tools, artifacts, or status"
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </label>
            <div className="mb-3 flex flex-wrap gap-1">
              {historyFilters.map((filter) => (
                <Button
                  key={filter.id}
                  type="button"
                  size="sm"
                  variant={activeFilter === filter.id ? "secondary" : "ghost"}
                  onClick={() => setActiveFilter(filter.id)}
                >
                  {filter.label} {filterCounts[filter.id]}
                </Button>
              ))}
            </div>
            {isLoadingHistory && !runs.length ? (
              <EmptyPanelText>Loading execution history.</EmptyPanelText>
            ) : filteredSearchedRuns.length ? (
              <ol className="space-y-2">
                {filteredSearchedRuns.map((run) => (
                  <li
                    key={run.id}
                    className={cn(
                      "border-border rounded-md border p-3 text-sm",
                      highlightedRunId === run.id
                        ? "border-primary/40 bg-primary/5 shadow-xs"
                        : selectedRunId === run.id
                          ? "bg-muted/40"
                          : "",
                    )}
                  >
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
                          {selectedRunId === run.id ? "Selected" : "Inspect"}
                        </Button>
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            ) : runs.length ? (
              <EmptyPanelText>No runs match the current search or filter.</EmptyPanelText>
            ) : (
              <EmptyPanelText>
                Run a tool, callback, or workflow to populate execution history.
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
              <SelectedRunSummary
                snapshot={selectedRunSnapshot}
                run={selectedRun}
                artifacts={selectedRunArtifacts}
                highlightedArtifactId={highlightedArtifactId}
                busyAction={busyAction}
                onRunAction={performRunAction}
                onApprovalAction={decideApproval}
              />
            ) : (
              <EmptyPanelText>No details returned for this run.</EmptyPanelText>
            )}
          </HistorySection>

          <HistorySection icon={FileTextIcon} title="Artifacts">
            {isLoadingHistory && !artifacts.length ? (
              <EmptyPanelText>Loading artifact metadata.</EmptyPanelText>
            ) : artifacts.length ? (
              <ol className="space-y-2">
                {artifacts.map((artifact) => (
                  <ArtifactPreviewCard
                    key={artifact.id}
                    artifact={artifact}
                    highlighted={highlightedArtifactId === artifact.id}
                  />
                ))}
              </ol>
            ) : (
              <EmptyPanelText>
                Metadata artifacts will appear after tools or callbacks create them.
              </EmptyPanelText>
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

type PreviewableArtifact = ArtifactSummary | CloudflareOwnedDemoRunSnapshot["artifacts"][number];

function SelectedRunSummary({
  snapshot,
  run,
  artifacts,
  highlightedArtifactId,
  busyAction,
  onRunAction,
  onApprovalAction,
}: {
  snapshot: CloudflareOwnedDemoRunSnapshot;
  run: ExecutionHistoryRunSummary | null;
  artifacts: ArtifactSummary[];
  highlightedArtifactId?: string | null;
  busyAction?: string | null;
  onRunAction: (action: "cancel" | "retry") => Promise<void>;
  onApprovalAction: (approvalId: string, action: "approve" | "deny") => Promise<void>;
}) {
  const snapshotArtifacts = snapshot.artifacts ?? [];
  const artifactMap = new Map<string, PreviewableArtifact>();
  for (const artifact of snapshotArtifacts) artifactMap.set(artifact.id, artifact);
  for (const artifact of artifacts) artifactMap.set(artifact.id, artifact);
  const previewArtifacts = Array.from(artifactMap.values());
  const runId = run?.id ?? snapshot.run?.id;
  const workflowIntentId =
    run?.workflowIntentId ?? snapshot.run?.workflowIntentId ?? snapshot.intent?.id;
  const pendingInterventions = (snapshot.interventions ?? []).filter(
    (intervention) => intervention.status === "requested",
  );

  return (
    <div className="space-y-3">
      {run?.summary ? (
        <p className="text-muted-foreground rounded-md border px-3 py-2 text-sm">{run.summary}</p>
      ) : null}

      {run?.controls?.canCancel || run?.controls?.canRetry ? (
        <div className="border-border flex flex-wrap items-center gap-2 border-y py-3">
          {run.controls.canCancel ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={Boolean(busyAction)}
              onClick={() => void onRunAction("cancel")}
            >
              {busyAction === "cancel" ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <CircleStopIcon />
              )}
              Cancel run
            </Button>
          ) : null}
          {run.controls.canRetry ? (
            <Button
              type="button"
              size="sm"
              disabled={Boolean(busyAction)}
              onClick={() => void onRunAction("retry")}
            >
              {busyAction === "retry" ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <RotateCcwIcon />
              )}
              Retry run
            </Button>
          ) : null}
        </div>
      ) : null}

      {pendingInterventions.map((intervention) => (
        <div
          key={intervention.id}
          className="border-border bg-muted/30 rounded-md border px-3 py-3"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <span className="min-w-0">
              <span className="block text-sm font-medium">{intervention.title}</span>
              <span className="text-muted-foreground mt-1 block text-xs">
                {intervention.reason}
              </span>
            </span>
            <span className="flex shrink-0 gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={Boolean(busyAction)}
                onClick={() => void onApprovalAction(intervention.id, "deny")}
              >
                {busyAction === `deny:${intervention.id}` ? (
                  <Loader2Icon className="animate-spin" />
                ) : null}
                Deny
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={Boolean(busyAction)}
                onClick={() => void onApprovalAction(intervention.id, "approve")}
              >
                {busyAction === `approve:${intervention.id}` ? (
                  <Loader2Icon className="animate-spin" />
                ) : null}
                Approve and resume
              </Button>
            </span>
          </div>
        </div>
      ))}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <StatusRow label="Status" value={run?.status ?? snapshot.run?.status} compact />
        <StatusRow
          label="Stage"
          value={run?.stage ?? snapshot.run?.stage ?? snapshot.intent?.stage}
          compact
        />
        <StatusRow label="Engine" value={run?.engine} compact />
        <StatusRow label="Intent" value={snapshot.intent?.type} compact />
        <StatusRow label="Tool calls" value={String(snapshot.toolCalls.length)} compact />
        <StatusRow label="Artifacts" value={String(previewArtifacts.length)} compact />
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <CopyId label="Run id" value={runId} />
        <CopyId label="Workflow intent id" value={workflowIntentId} />
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

      <div>
        <h3 className="mb-2 text-xs font-semibold">Artifacts</h3>
        {previewArtifacts.length ? (
          <ol className="space-y-2">
            {previewArtifacts.slice(0, 6).map((artifact) => (
              <ArtifactPreviewCard
                key={artifact.id}
                artifact={artifact}
                highlighted={highlightedArtifactId === artifact.id}
              />
            ))}
          </ol>
        ) : (
          <EmptyPanelText>No artifacts attached to this run.</EmptyPanelText>
        )}
      </div>

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

function ArtifactPreviewCard({
  artifact,
  highlighted,
}: {
  artifact: PreviewableArtifact;
  highlighted?: boolean;
}) {
  const [copiedUri, setCopiedUri] = useState(false);
  const preview = buildArtifactPreview(artifact);
  const sizeBytes = "sizeBytes" in artifact ? formatBytes(artifact.sizeBytes) : undefined;
  const createdAt = "createdAt" in artifact ? formatAge(artifact.createdAt) : undefined;
  const kind = "kind" in artifact ? artifact.kind : undefined;
  const uri = artifact.uri;
  const openable = isOpenableArtifactUri(uri);

  const copyUri = async () => {
    if (!uri) return;
    await navigator.clipboard.writeText(uri);
    setCopiedUri(true);
    window.setTimeout(() => setCopiedUri(false), 1200);
  };

  const openUri = () => {
    if (!openable || !uri) return;
    window.open(uri, "_blank", "noopener,noreferrer");
  };

  return (
    <li
      className={cn(
        "border-border rounded-md border p-3 text-sm",
        highlighted ? "border-primary/40 bg-primary/5 shadow-xs" : "",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block truncate font-medium">{preview.title}</span>
          <span className="text-muted-foreground text-xs">
            {[
              kind ?? "artifact",
              artifact.mimeType ?? "metadata",
              sizeBytes ?? "size unknown",
              createdAt,
            ]
              .filter(Boolean)
              .join(" / ")}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <Button type="button" variant="ghost" size="icon-xs" onClick={copyUri} disabled={!uri}>
            {copiedUri ? <CheckIcon /> : <ClipboardIcon />}
            <span className="sr-only">Copy artifact URI</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={openUri}
            disabled={!openable}
          >
            <ExternalLinkIcon />
            <span className="sr-only">Open artifact URI</span>
          </Button>
        </span>
      </div>

      <div className="mt-2 space-y-1">
        {preview.lines.slice(0, 3).map((line, index) => (
          <p
            key={`${artifact.id}-line-${index}`}
            className="text-muted-foreground text-xs break-words"
          >
            {line}
          </p>
        ))}
      </div>

      <div className="mt-3 space-y-2">
        <CopyId label="Artifact id" value={artifact.id} />
        <CopyId label="Artifact URI" value={uri} />
      </div>

      {preview.json ? (
        <details className="mt-3">
          <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-xs">
            Metadata JSON
          </summary>
          <pre className="bg-muted mt-2 max-h-44 overflow-auto rounded-md p-2 text-xs whitespace-pre-wrap">
            {preview.json}
          </pre>
        </details>
      ) : null}
    </li>
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
