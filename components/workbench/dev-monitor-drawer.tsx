"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ActivityIcon,
  AlertCircleIcon,
  Building2Icon,
  FileTextIcon,
  LinkIcon,
  Loader2Icon,
  MessageSquareIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  UserIcon,
  WrenchIcon,
} from "lucide-react";

import {
  CopyId,
  EmptyPanelText,
  formatTime,
  MonitorSection,
  RuntimeRecord,
  StatusPill,
  StatusRow,
  terminalStatuses,
} from "@/components/workbench/dev-monitor-primitives";
import {
  approvalTone,
  DetailsBlock,
  formatAge,
  formatDuration,
  LiveRequestMap,
} from "@/components/workbench/dev-monitor-sections";
import { useWorkbenchComposerFocus } from "@/components/workbench/composer-focus-context";
import { NewChatButton } from "@/components/workbench/new-chat-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  requestWorkbenchSummaryRefresh,
  workbenchSummaryRefreshEvent,
  type WorkbenchSummaryRefreshSource,
} from "@/lib/workbench/admin-summary-events";
import { deriveRuntimeState } from "@/lib/workbench/chat-runtime-live-state";
import { useAdminSummaryResource } from "@/lib/workbench/use-admin-summary-resource";
import { useWorkbenchAgentConnection } from "@/lib/workbench/use-agent-connection";
import type {
  AgentBehaviorTemplate,
  ArtifactSummary,
  CloudflareArtifactHistoryResponse,
  CloudflareAgentBehaviorTemplatesResponse,
  CloudflareExecutionHistoryResponse,
  CloudflareExecutionHistoryRunResponse,
  CloudflareToolApprovalsResponse,
  CloudflareOwnedDemoRunResponse,
  CloudflareOwnedDemoRunSnapshot,
  CloudflareToolApprovalActionResponse,
  CloudflareToolPolicyUpdateResponse,
  CloudflareToolRunResponse,
  ExecutionHistoryRunSummary,
  ToolApprovalRequestSummary,
} from "@/lib/workbench/workbench-types";

const cloudflareDemoRunsPath = "/api/workbench/cloudflare-demo-runs";
const workspacesPath = "/api/workbench/workspaces";
const agentsPath = "/api/workbench/agents";
const behaviorTemplatesPath = "/api/workbench/agent-behavior-templates";
const toolRunsPath = "/api/workbench/tools/runs";
const toolPolicyPath = "/api/workbench/tools/policy";
const toolApprovalsPath = "/api/workbench/tools/approvals";
const historyRunsPath = "/api/workbench/history/runs";
const historyArtifactsPath = "/api/workbench/history/artifacts";
const agentModelOptions = ["deepseek/deepseek-v4-flash", "openai/gpt-4.1-mini"] as const;
const defaultBehaviorTemplateByProfile = {
  default: "assistant-general",
  analyst: "assistant-analyst",
  operator: "assistant-operator",
} as const satisfies Record<"default" | "analyst" | "operator", AgentBehaviorTemplate["id"]>;

const readJsonResponse = async <T,>(response: Response, fallback: string): Promise<T> => {
  const body = (await response.json().catch(() => ({}))) as T & { error?: unknown };
  if (!response.ok) {
    const error =
      typeof body.error === "string"
        ? body.error
        : isRecord(body.error) && typeof body.error.message === "string"
          ? body.error.message
          : fallback;
    throw new Error(error);
  }
  return body;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const listValue = (items?: string[]) => (items && items.length > 0 ? items.join(", ") : undefined);

const runHistoryTitle = (run: ExecutionHistoryRunSummary) =>
  run.displayName ?? run.summary ?? run.id;

const formatBytes = (value?: number) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
};

const snapshotDisplayJson = (snapshot: CloudflareOwnedDemoRunSnapshot) => ({
  scope: snapshot.scope,
  intent: snapshot.intent
    ? {
        id: snapshot.intent.id,
        type: snapshot.intent.type,
        stage: snapshot.intent.stage,
        execution: snapshot.intent.execution,
      }
    : null,
  run: snapshot.run
    ? {
        id: snapshot.run.id,
        status: snapshot.run.status,
        workflowIntentId: snapshot.run.workflowIntentId,
        execution: snapshot.run.execution,
        stage: snapshot.run.stage,
        relation: snapshot.run.relation,
        updatedAt: snapshot.run.updatedAt,
      }
    : null,
  toolCalls: snapshot.toolCalls,
  childRuns: snapshot.childRuns ?? [],
  artifacts: snapshot.artifacts,
  decisions: snapshot.decisions,
  auditEvents: snapshot.auditEvents,
});

export function AdminPanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { focusComposer } = useWorkbenchComposerFocus();
  const {
    connection,
    error,
    session,
    pending,
    isInitialLoading,
    isSessionStreamConnected,
    latestSessionEvent,
  } = useWorkbenchAgentConnection();
  const {
    summary,
    error: summaryError,
    isLoading: isLoadingSummary,
    lastRefreshSource,
    lastDurationMs,
    refreshSummary,
    setProjectionPreference,
  } = useAdminSummaryResource();
  const [approvalQueue, setApprovalQueue] = useState<ToolApprovalRequestSummary[]>([]);
  const [behaviorTemplates, setBehaviorTemplates] = useState<AgentBehaviorTemplate[]>([]);
  const [historyRuns, setHistoryRuns] = useState<ExecutionHistoryRunSummary[]>([]);
  const [historyArtifacts, setHistoryArtifacts] = useState<ArtifactSummary[]>([]);
  const [isLoadingApprovals, setIsLoadingApprovals] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isLoadingRunSnapshot, setIsLoadingRunSnapshot] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isRunningTool, setIsRunningTool] = useState(false);
  const [updatingToolPolicy, setUpdatingToolPolicy] = useState<string | null>(null);
  const [updatingApprovalId, setUpdatingApprovalId] = useState<string | null>(null);
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
  const [isCreatingAgent, setIsCreatingAgent] = useState(false);
  const [activatingWorkspaceId, setActivatingWorkspaceId] = useState<string | null>(null);
  const [activatingAgentId, setActivatingAgentId] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState("");
  const [urlInspectTarget, setUrlInspectTarget] = useState("");
  const [agentName, setAgentName] = useState("");
  const [agentDescription, setAgentDescription] = useState("");
  const [agentProfile, setAgentProfile] = useState<"default" | "analyst" | "operator">("analyst");
  const [agentModel, setAgentModel] = useState<(typeof agentModelOptions)[number]>(
    "deepseek/deepseek-v4-flash",
  );
  const [agentBehaviorTemplateId, setAgentBehaviorTemplateId] =
    useState<AgentBehaviorTemplate["id"]>("assistant-analyst");
  const [approvalDialog, setApprovalDialog] = useState<{
    approval: ToolApprovalRequestSummary;
    action: "approve" | "deny";
  } | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedRunSnapshot, setSelectedRunSnapshot] =
    useState<CloudflareOwnedDemoRunSnapshot | null>(null);
  const [denyReason, setDenyReason] = useState("");
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [runSnapshotError, setRunSnapshotError] = useState<string | null>(null);

  const demoSnapshot = summary?.demo.latestRun ?? null;
  const chatRuntime = summary?.chatRuntime ?? null;
  const latestTrace = summary?.latestTrace ?? null;
  const traceWaterfall = summary?.traceWaterfall ?? [];
  const run = demoSnapshot?.run;
  const isDemoActive = run?.status ? !terminalStatuses.has(run.status) : false;
  const liveRuntime = deriveRuntimeState({
    session,
    connection,
    error,
    isSessionStreamConnected,
    latestSessionEvent,
    pending,
    isInitialLoading,
    summary,
    summaryError,
  });
  const isChatActive = liveRuntime.chatState === "running";
  const latestToolCall = demoSnapshot?.toolCalls.at(-1);
  const latestArtifact = demoSnapshot?.artifacts.at(-1);
  const latestAdminToolCall = summary?.latestToolCalls?.at(0) ?? null;
  const latestAdminArtifact = summary?.latestArtifacts?.at(0) ?? null;
  const latestHistoryRun = historyRuns.at(0) ?? null;
  const latestHistoryArtifact = historyArtifacts.at(0) ?? null;
  const selectedHistoryRun =
    historyRuns.find((historyRun) => historyRun.id === selectedRunId) ?? null;
  const urlInspectTool = summary?.tools?.find((tool) => tool.name === "url.inspect") ?? null;
  const pendingApprovals = approvalQueue.filter((approval) => approval.status === "requested");
  const decidedApprovals = approvalQueue.filter((approval) => approval.status !== "requested");
  const selectedApprovalPolicy = approvalDialog?.approval.currentPolicy;
  const selectedApprovalPolicyBlocked = selectedApprovalPolicy?.decision === "block";
  const latestDecision = demoSnapshot?.decisions.at(-1);
  const latestChatEvent = useMemo(
    () =>
      chatRuntime?.events.at(0) ?? summary?.events.find((event) => event.type?.startsWith("chat.")),
    [chatRuntime?.events, summary?.events],
  );
  const latestMeaningfulEvent = latestChatEvent ?? summary?.events.at(0) ?? null;
  const canManageWorkspaces =
    summary?.membership?.status === "active" &&
    ["owner", "admin"].includes(summary.membership.role.toLowerCase());
  const canManageAgents = canManageWorkspaces;
  const importantError = fetchError
    ? { message: fetchError, source: "drawer action", status: undefined, targetId: undefined }
    : summaryError
      ? { message: summaryError, source: "summary", status: undefined, targetId: undefined }
      : error
        ? { message: error, source: "session", status: undefined, targetId: undefined }
        : liveRuntime.errorMessage && !chatRuntime?.failure && !summary?.lastError
          ? {
              message: liveRuntime.errorMessage,
              source: liveRuntime.sourceLabel,
              status: undefined,
              targetId: liveRuntime.activeThreadId,
            }
          : chatRuntime?.failure
            ? {
                message: chatRuntime.failure.message,
                source: chatRuntime.failure.source,
                status: chatRuntime.failure.status,
                targetId: chatRuntime.failure.targetId,
                errorCode: chatRuntime.failure.errorCode,
              }
            : summary?.lastError
              ? {
                  message: summary.lastError.message,
                  source: summary.lastError.source,
                  status: summary.lastError.status,
                  targetId: summary.lastError.targetId,
                  errorCode: undefined,
                }
              : null;
  const chatLabel = liveRuntime.chatLabel;
  const chatTone = liveRuntime.chatTone;
  const summaryStateLabel = summaryError
    ? "Summary fetch failed"
    : liveRuntime.summaryIsStale
      ? "Stale behind live event"
      : summary
        ? "Summary refreshed"
        : "Not loaded";
  const summaryRefreshMeta =
    lastRefreshSource && typeof lastDurationMs === "number"
      ? `${lastRefreshSource} / ${lastDurationMs}ms`
      : (lastRefreshSource ?? null);
  const selectedBehaviorTemplate = useMemo(
    () => behaviorTemplates.find((template) => template.id === agentBehaviorTemplateId) ?? null,
    [agentBehaviorTemplateId, behaviorTemplates],
  );
  const selectedRunState = selectedRunId
    ? isLoadingRunSnapshot
      ? "Loading snapshot"
      : runSnapshotError
        ? "Snapshot failed"
        : (selectedRunSnapshot?.run?.status ?? selectedHistoryRun?.status ?? "Selected")
    : "No run selected";

  const loadApprovals = async () => {
    setIsLoadingApprovals(true);
    try {
      const response = await fetch(`${toolApprovalsPath}?status=all&limit=20`, {
        cache: "no-store",
      });
      const body = await readJsonResponse<CloudflareToolApprovalsResponse>(
        response,
        "Failed to load tool approvals",
      );
      setApprovalQueue(body.approvals ?? []);
      setFetchError(null);
    } catch (loadError) {
      setFetchError(loadError instanceof Error ? loadError.message : "Failed to load approvals");
    } finally {
      setIsLoadingApprovals(false);
    }
  };

  const loadHistory = async () => {
    setIsLoadingHistory(true);
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
      setHistoryRuns(runsBody.runs ?? []);
      setHistoryArtifacts(artifactsBody.artifacts ?? []);
      setHistoryError(null);
    } catch (loadError) {
      setHistoryError(loadError instanceof Error ? loadError.message : "Failed to load history");
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const inspectHistoryRun = async (runId: string) => {
    setSelectedRunId(runId);
    setIsLoadingRunSnapshot(true);
    setRunSnapshotError(null);
    try {
      const response = await fetch(`${historyRunsPath}/${encodeURIComponent(runId)}`, {
        cache: "no-store",
      });
      const body = await readJsonResponse<CloudflareExecutionHistoryRunResponse>(
        response,
        "Failed to load run snapshot",
      );
      setSelectedRunSnapshot(body.snapshot ?? null);
    } catch (loadError) {
      setSelectedRunSnapshot(null);
      setRunSnapshotError(
        loadError instanceof Error ? loadError.message : "Failed to load run snapshot",
      );
    } finally {
      setIsLoadingRunSnapshot(false);
    }
  };

  const loadBehaviorTemplates = async () => {
    try {
      const response = await fetch(behaviorTemplatesPath, { cache: "no-store" });
      const body = await readJsonResponse<CloudflareAgentBehaviorTemplatesResponse>(
        response,
        "Failed to load agent behavior templates",
      );
      setBehaviorTemplates(body.templates ?? []);
    } catch (loadError) {
      setFetchError(
        loadError instanceof Error ? loadError.message : "Failed to load agent behavior templates",
      );
    }
  };

  const loadDrawerData = () => {
    void loadApprovals();
    void loadHistory();
  };

  const loadAdminData = (source: WorkbenchSummaryRefreshSource = "event", force = false) => {
    void refreshSummary({ source, force, projection: "drawer" });
    loadDrawerData();
  };

  useEffect(() => {
    if (!open) return;
    setProjectionPreference("drawer");
    loadAdminData("drawer-open");
    void loadBehaviorTemplates();
    const refreshDrawerData = () => loadDrawerData();
    window.addEventListener(workbenchSummaryRefreshEvent, refreshDrawerData);
    return () => {
      setProjectionPreference("compact");
      window.removeEventListener(workbenchSummaryRefreshEvent, refreshDrawerData);
    };
  }, [open, refreshSummary, setProjectionPreference]);

  useEffect(() => {
    if (!open || (isSessionStreamConnected && !isDemoActive && !isChatActive)) return;
    const interval = window.setInterval(() => {
      loadAdminData("fallback-poll");
    }, 4000);
    return () => window.clearInterval(interval);
  }, [open, isSessionStreamConnected, isDemoActive, isChatActive, refreshSummary]);

  const startDemoRun = async () => {
    setIsStarting(true);
    setFetchError(null);
    try {
      const response = await fetch(cloudflareDemoRunsPath, { method: "POST" });
      await readJsonResponse<CloudflareOwnedDemoRunResponse>(
        response,
        "Failed to start Cloudflare demo run",
      );
      requestWorkbenchSummaryRefresh({ source: "event" });
    } catch (startError) {
      setFetchError(
        startError instanceof Error ? startError.message : "Failed to start Cloudflare demo run",
      );
    } finally {
      setIsStarting(false);
    }
  };

  const runUrlInspect = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const url = urlInspectTarget.trim();
    if (!url) return;

    setIsRunningTool(true);
    setFetchError(null);
    try {
      await readJsonResponse<CloudflareToolRunResponse>(
        await fetch(toolRunsPath, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            toolName: "url.inspect",
            executionMode: "dry_run",
            input: { url },
          }),
        }),
        "Failed to run URL inspector",
      );
      requestWorkbenchSummaryRefresh({ source: "event" });
    } catch (toolError) {
      setFetchError(toolError instanceof Error ? toolError.message : "Failed to run URL inspector");
      requestWorkbenchSummaryRefresh({ source: "event" });
    } finally {
      setIsRunningTool(false);
    }
  };

  const updateUrlInspectPolicy = async (input: {
    status?: "enabled" | "disabled";
    requiresApproval?: boolean;
    killSwitchReason?: string;
    modelVisible?: boolean;
  }) => {
    setUpdatingToolPolicy("url.inspect");
    setFetchError(null);
    try {
      await readJsonResponse<CloudflareToolPolicyUpdateResponse>(
        await fetch(toolPolicyPath, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            toolName: "url.inspect",
            ...input,
          }),
        }),
        "Failed to update URL inspector policy",
      );
      requestWorkbenchSummaryRefresh({ source: "event" });
    } catch (policyError) {
      setFetchError(
        policyError instanceof Error ? policyError.message : "Failed to update tool policy",
      );
    } finally {
      setUpdatingToolPolicy(null);
    }
  };

  const openApprovalDialog = (approval: ToolApprovalRequestSummary, action: "approve" | "deny") => {
    setApprovalDialog({ approval, action });
    setDenyReason("");
  };

  const decideToolApproval = async (
    approvalRequestId: string,
    action: "approve" | "deny",
    reason?: string,
  ) => {
    setUpdatingApprovalId(approvalRequestId);
    setFetchError(null);
    try {
      await readJsonResponse<CloudflareToolApprovalActionResponse>(
        await fetch(`${toolApprovalsPath}/${encodeURIComponent(approvalRequestId)}/${action}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body:
            action === "deny"
              ? JSON.stringify({ reason: reason?.trim() || "Denied from Admin Tools." })
              : undefined,
        }),
        action === "approve" ? "Failed to approve tool run" : "Failed to deny tool run",
      );
      setApprovalDialog(null);
      await Promise.all([
        refreshSummary({ source: "event", force: true }),
        loadApprovals(),
        loadHistory(),
      ]);
      requestWorkbenchSummaryRefresh({ source: "event" });
    } catch (approvalError) {
      setFetchError(
        approvalError instanceof Error ? approvalError.message : "Failed to update approval",
      );
      requestWorkbenchSummaryRefresh({ source: "event" });
    } finally {
      setUpdatingApprovalId(null);
    }
  };

  const createWorkspace = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = workspaceName.trim();
    if (!name) return;

    setIsCreatingWorkspace(true);
    setFetchError(null);
    try {
      const response = await fetch(workspacesPath, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      await readJsonResponse(response, "Failed to create workspace");
      setWorkspaceName("");
      requestWorkbenchSummaryRefresh({ source: "event" });
    } catch (createError) {
      setFetchError(
        createError instanceof Error ? createError.message : "Failed to create workspace",
      );
    } finally {
      setIsCreatingWorkspace(false);
    }
  };

  const activateWorkspace = async (workspaceId: string) => {
    setActivatingWorkspaceId(workspaceId);
    setFetchError(null);
    try {
      const response = await fetch(
        `${workspacesPath}/${encodeURIComponent(workspaceId)}/activate`,
        { method: "POST" },
      );
      await readJsonResponse(response, "Failed to activate workspace");
      requestWorkbenchSummaryRefresh({ source: "event" });
    } catch (activateError) {
      setFetchError(
        activateError instanceof Error ? activateError.message : "Failed to activate workspace",
      );
    } finally {
      setActivatingWorkspaceId(null);
    }
  };

  const createAgent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = agentName.trim();
    if (!name) return;

    setIsCreatingAgent(true);
    setFetchError(null);
    try {
      const response = await fetch(agentsPath, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          description: agentDescription.trim() || undefined,
          profile: agentProfile,
          model: agentModel,
          behaviorTemplateId: agentBehaviorTemplateId,
          activate: true,
        }),
      });
      await readJsonResponse(response, "Failed to create agent");
      setAgentName("");
      setAgentDescription("");
      setAgentProfile("analyst");
      setAgentModel("deepseek/deepseek-v4-flash");
      setAgentBehaviorTemplateId("assistant-analyst");
      requestWorkbenchSummaryRefresh({ source: "event" });
    } catch (createError) {
      setFetchError(createError instanceof Error ? createError.message : "Failed to create agent");
    } finally {
      setIsCreatingAgent(false);
    }
  };

  const activateAgent = async (agentId: string) => {
    setActivatingAgentId(agentId);
    setFetchError(null);
    try {
      const response = await fetch(`${agentsPath}/${encodeURIComponent(agentId)}/activate`, {
        method: "POST",
      });
      await readJsonResponse(response, "Failed to activate agent");
      requestWorkbenchSummaryRefresh({ source: "event" });
    } catch (activateError) {
      setFetchError(
        activateError instanceof Error ? activateError.message : "Failed to activate agent",
      );
    } finally {
      setActivatingAgentId(null);
    }
  };

  const confirmApprovalDialog = () => {
    if (!approvalDialog?.approval.id) return;
    void decideToolApproval(
      approvalDialog.approval.id,
      approvalDialog.action,
      approvalDialog.action === "deny" ? denyReason : undefined,
    );
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="grid h-[min(85vh,56rem)] w-[min(80vw,72rem)] max-w-[calc(100vw-2rem)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-[min(80vw,72rem)]"
          aria-describedby="admin-panel-description"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            focusComposer();
          }}
        >
          <DialogHeader className="border-border border-b px-5 py-4">
            <DialogTitle className="flex items-center gap-2 text-base">
              <ShieldCheckIcon className="text-muted-foreground size-4" />
              Admin
            </DialogTitle>
            <DialogDescription id="admin-panel-description">
              Flow-first view of Cloudflare-owned chat, workspace, agent, and diagnostic state.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-muted-foreground text-xs">
                Summary generated {formatTime(summary?.generatedAt)} / {summaryStateLabel}
                {summaryRefreshMeta ? ` / ${summaryRefreshMeta}` : ""}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => loadAdminData("manual", true)}
                disabled={isLoadingSummary || isLoadingApprovals || isLoadingHistory}
              >
                {isLoadingSummary || isLoadingApprovals || isLoadingHistory ? (
                  <Loader2Icon className="animate-spin" />
                ) : (
                  <RefreshCwIcon />
                )}
                Refresh
              </Button>
            </div>

            <LiveRequestMap trace={latestTrace} spans={traceWaterfall} />

            <MonitorSection icon={ActivityIcon} title="Current State">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill status={chatLabel} tone={chatTone} />
                {importantError ? <StatusPill status="Needs attention" tone="failed" /> : null}
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <StatusRow
                  label="Workspace"
                  value={session?.workspace?.name ?? summary?.workspace?.name}
                  compact
                  tone="ok"
                />
                <StatusRow label="Agent" value={liveRuntime.activeAgentLabel} compact tone="ok" />
                <StatusRow
                  label="Model"
                  value={liveRuntime.modelLabel ?? summary?.activeAgent?.runtime.model}
                  compact
                  tone="ok"
                />
                <StatusRow label="Runtime source" value={liveRuntime.sourceLabel} compact />
                <StatusRow label="Summary" value={summaryStateLabel} compact />
                <StatusRow
                  label="Active thread"
                  value={liveRuntime.activeThreadTitle ?? liveRuntime.activeThreadId}
                  compact
                />
                <StatusRow
                  label="Latest chat event"
                  value={latestMeaningfulEvent?.summary ?? latestMeaningfulEvent?.type}
                  compact
                />
                <StatusRow
                  label="Last error"
                  value={importantError?.message ?? "No current error"}
                  compact
                  tone={importantError ? "muted" : "ok"}
                />
                <StatusRow
                  label="Session display"
                  value={
                    session?.isStale
                      ? "Cached, refreshing"
                      : pending
                        ? "Transitioning"
                        : session?.partial
                          ? "Partial, refreshing history"
                          : "Cloudflare current"
                  }
                  compact
                  tone={session?.isStale || session?.partial ? "muted" : "ok"}
                />
                <StatusRow
                  label="Session stream"
                  value={isSessionStreamConnected ? "Live" : "Disconnected"}
                  compact
                  tone={isSessionStreamConnected ? "ok" : "muted"}
                />
                <StatusRow
                  label="Connection"
                  value={connection ? "Agent token ready" : "Waiting for Agent token"}
                  compact
                  tone={connection ? "ok" : "muted"}
                />
                <StatusRow
                  label="Latest live event"
                  value={latestSessionEvent?.type ?? "none yet"}
                  compact
                />
              </div>
              {importantError ? (
                <div className="border-destructive/30 bg-destructive/10 rounded-md border p-3 text-sm">
                  <p className="text-destructive font-medium">{importantError.message}</p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    Open Advanced Details for source, status, and target ids.
                  </p>
                </div>
              ) : null}
            </MonitorSection>

            <MonitorSection icon={MessageSquareIcon} title="Chat Flow">
              <div className="flex items-center justify-between gap-3">
                <p className="text-muted-foreground text-xs">
                  Start a fresh Cloudflare-owned thread for the current workspace and agent.
                </p>
                <NewChatButton className="shrink-0" />
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <StatusRow
                  label="Chat"
                  value={chatLabel}
                  compact
                  tone={
                    liveRuntime.chatState === "thread_ready" ||
                    liveRuntime.chatState === "completed"
                      ? "ok"
                      : "muted"
                  }
                />
                <StatusRow
                  label="Run"
                  value={chatRuntime?.latestRun?.status ?? "No run yet"}
                  compact
                />
                <StatusRow
                  label="Error category"
                  value={chatRuntime?.failure?.errorCode ?? "none"}
                  compact
                />
                <StatusRow
                  label="Thread"
                  value={
                    chatRuntime?.latestThread
                      ? `${chatRuntime.latestThread.status ?? "active"}${
                          chatRuntime.latestRun ? "" : " / fresh"
                        }`
                      : "No thread yet"
                  }
                  compact
                />
                <StatusRow
                  label="Runtime"
                  value={
                    chatRuntime?.latestRun?.metadata?.runtime
                      ? String(chatRuntime.latestRun.metadata.runtime)
                      : "cloudflare-agent-chat"
                  }
                  compact
                />
                <StatusRow
                  label="First token"
                  value={formatDuration(chatRuntime?.timings?.firstTokenMs)}
                  compact
                />
                <StatusRow
                  label="Total runtime"
                  value={formatDuration(chatRuntime?.timings?.totalMs)}
                  compact
                />
                <StatusRow
                  label="Policy"
                  value={
                    chatRuntime?.latestPolicyDecision
                      ? `${chatRuntime.latestPolicyDecision.decision}: ${chatRuntime.latestPolicyDecision.reason}`
                      : "No policy decision yet"
                  }
                  compact
                />
              </div>
              {chatRuntime?.failure ? (
                <div className="border-destructive/30 bg-destructive/10 rounded-md border p-3 text-sm">
                  <p className="text-destructive font-medium">{chatRuntime.failure.message}</p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {chatRuntime.failure.source}
                    {chatRuntime.failure.status ? ` / ${chatRuntime.failure.status}` : ""}
                    {chatRuntime.failure.errorCode ? ` / ${chatRuntime.failure.errorCode}` : ""}
                  </p>
                </div>
              ) : (
                <EmptyPanelText>
                  {fetchError && !chatRuntime
                    ? "The drawer could not load the Cloudflare summary. Check the current session or local auth fallback."
                    : chatRuntime?.state === "no_session" || chatRuntime?.state === "no_thread"
                      ? "Send a message to create the first chat session for this workspace."
                      : "Chat state is being read from Cloudflare for the active workspace and agent."}
                </EmptyPanelText>
              )}
            </MonitorSection>

            <MonitorSection icon={UserIcon} title="Current Scope">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <StatusRow
                  label="User"
                  value={summary?.user?.email ?? summary?.user?.displayName}
                />
                <StatusRow
                  label="Account"
                  value={summary?.account?.source ?? summary?.identity.workspaceSource}
                />
                <StatusRow
                  label="Membership"
                  value={
                    summary?.membership
                      ? `${summary.membership.role} / ${summary.membership.status}`
                      : undefined
                  }
                />
                <StatusRow
                  label="Admin controls"
                  value={summary?.membership ? (canManageWorkspaces ? "Enabled" : "Read only") : ""}
                />
                <StatusRow
                  label="Active model"
                  value={
                    summary?.activeAgent?.runtime
                      ? `${summary.activeAgent.runtime.model} / ${summary.activeAgent.runtime.source}`
                      : undefined
                  }
                />
              </div>
            </MonitorSection>

            <MonitorSection icon={FileTextIcon} title="Execution History">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <StatusRow
                  label="Latest run"
                  value={
                    latestHistoryRun
                      ? `${latestHistoryRun.status ?? "unknown"} / ${formatAge(
                          latestHistoryRun.updatedAt ?? latestHistoryRun.createdAt,
                        )}`
                      : "No run history"
                  }
                  compact
                  tone={latestHistoryRun ? "ok" : "muted"}
                />
                <StatusRow
                  label="Latest artifact"
                  value={
                    latestHistoryArtifact
                      ? (latestHistoryArtifact.title ?? latestHistoryArtifact.id)
                      : "No artifacts"
                  }
                  compact
                  tone={latestHistoryArtifact ? "ok" : "muted"}
                />
                <StatusRow
                  label="Loaded runs"
                  value={isLoadingHistory ? "Loading" : String(historyRuns.length)}
                  compact
                />
                <StatusRow label="Selected run" value={selectedRunState} compact />
              </div>

              {historyError ? (
                <div className="border-destructive/30 bg-destructive/10 rounded-md border p-3 text-sm">
                  <p className="text-destructive font-medium">{historyError}</p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    Summary and approval data can still render while history reloads.
                  </p>
                </div>
              ) : null}

              <DetailsBlock title="Recent runs" defaultOpen>
                {isLoadingHistory && !historyRuns.length ? (
                  <EmptyPanelText>Loading execution history.</EmptyPanelText>
                ) : historyRuns.length ? (
                  <ol className="space-y-2">
                    {historyRuns.map((historyRun) => (
                      <li
                        key={historyRun.id}
                        className="border-border rounded-md border p-3 text-sm"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <span className="min-w-0">
                            <span className="block truncate font-medium">
                              {runHistoryTitle(historyRun)}
                            </span>
                            <span className="text-muted-foreground block text-xs">
                              {historyRun.stage ?? "unknown stage"} /{" "}
                              {historyRun.engine ?? "unknown engine"} /{" "}
                              {historyRun.toolCallCount ?? 0} tool calls
                            </span>
                            <span className="text-muted-foreground/80 block text-xs">
                              {formatAge(historyRun.updatedAt ?? historyRun.createdAt)}
                              {historyRun.completedAt
                                ? ` / completed ${formatTime(historyRun.completedAt)}`
                                : ""}
                              {historyRun.failedAt
                                ? ` / failed ${formatTime(historyRun.failedAt)}`
                                : ""}
                            </span>
                            {historyRun.artifactIds?.length || historyRun.decisionIds?.length ? (
                              <span className="text-muted-foreground block text-xs">
                                {(historyRun.artifactIds?.length ?? 0).toString()} artifacts /{" "}
                                {(historyRun.decisionIds?.length ?? 0).toString()} decisions
                              </span>
                            ) : null}
                          </span>
                          <span className="flex shrink-0 flex-col items-end gap-2">
                            <StatusPill
                              status={historyRun.status ?? "unknown"}
                              tone={historyRun.status}
                            />
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={isLoadingRunSnapshot && selectedRunId === historyRun.id}
                              onClick={() => void inspectHistoryRun(historyRun.id)}
                            >
                              {isLoadingRunSnapshot && selectedRunId === historyRun.id ? (
                                <Loader2Icon className="animate-spin" />
                              ) : (
                                <FileTextIcon />
                              )}
                              Inspect
                            </Button>
                          </span>
                        </div>
                        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <CopyId label="Run id" value={historyRun.id} />
                          <CopyId label="Workflow intent id" value={historyRun.workflowIntentId} />
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <EmptyPanelText>
                    Run a tool, diagnostic, callback, or chat workflow to populate execution
                    history.
                  </EmptyPanelText>
                )}
              </DetailsBlock>

              <DetailsBlock title="Selected run snapshot" defaultOpen={Boolean(selectedRunId)}>
                {!selectedRunId ? (
                  <EmptyPanelText>Select a run to inspect its stored D1 snapshot.</EmptyPanelText>
                ) : isLoadingRunSnapshot ? (
                  <EmptyPanelText>Loading run snapshot.</EmptyPanelText>
                ) : runSnapshotError ? (
                  <div className="border-destructive/30 bg-destructive/10 rounded-md border p-3 text-sm">
                    <p className="text-destructive font-medium">{runSnapshotError}</p>
                    <CopyId label="Run id" value={selectedRunId} />
                  </div>
                ) : selectedRunSnapshot ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <StatusRow
                        label="Run status"
                        value={selectedRunSnapshot.run?.status}
                        compact
                        tone={selectedRunSnapshot.run?.status === "completed" ? "ok" : "muted"}
                      />
                      <StatusRow
                        label="Intent"
                        value={selectedRunSnapshot.intent?.type ?? selectedRunSnapshot.intent?.id}
                        compact
                      />
                      <StatusRow
                        label="Stage"
                        value={selectedRunSnapshot.run?.stage ?? selectedRunSnapshot.intent?.stage}
                        compact
                      />
                      <StatusRow
                        label="Tool calls"
                        value={String(selectedRunSnapshot.toolCalls.length)}
                        compact
                      />
                      <StatusRow
                        label="Artifacts"
                        value={String(selectedRunSnapshot.artifacts.length)}
                        compact
                      />
                      <StatusRow
                        label="Decisions"
                        value={String(selectedRunSnapshot.decisions.length)}
                        compact
                      />
                    </div>

                    <DetailsBlock title="Snapshot tool calls">
                      {selectedRunSnapshot.toolCalls.length ? (
                        <ol className="space-y-2">
                          {selectedRunSnapshot.toolCalls.slice(0, 8).map((toolCall) => (
                            <li
                              key={toolCall.id}
                              className="border-border rounded-md border p-3 text-sm"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <span className="min-w-0">
                                  <span className="block truncate font-medium">
                                    {toolCall.toolId ?? "unknown tool"}
                                  </span>
                                  <span className="text-muted-foreground block text-xs">
                                    {toolCall.outputSummary ??
                                      toolCall.inputSummary ??
                                      "Tool call recorded."}
                                  </span>
                                </span>
                                <StatusPill
                                  status={toolCall.status ?? "unknown"}
                                  tone={toolCall.status}
                                />
                              </div>
                              <CopyId label="Tool call id" value={toolCall.id} />
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <EmptyPanelText>No tool calls attached to this run.</EmptyPanelText>
                      )}
                    </DetailsBlock>

                    <DetailsBlock title="Snapshot artifacts">
                      {selectedRunSnapshot.artifacts.length ? (
                        <ol className="space-y-2">
                          {selectedRunSnapshot.artifacts.slice(0, 8).map((artifact) => (
                            <li
                              key={artifact.id}
                              className="border-border rounded-md border p-3 text-sm"
                            >
                              <p className="truncate font-medium">
                                {artifact.title ?? artifact.id}
                              </p>
                              <p className="text-muted-foreground mt-1 break-all text-xs">
                                {artifact.uri ?? "metadata artifact"}
                              </p>
                              <CopyId label="Artifact id" value={artifact.id} />
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <EmptyPanelText>No artifacts attached to this run.</EmptyPanelText>
                      )}
                    </DetailsBlock>

                    <DetailsBlock title="Snapshot decisions">
                      {selectedRunSnapshot.decisions.length ? (
                        <ol className="space-y-2">
                          {selectedRunSnapshot.decisions.slice(0, 8).map((decision) => (
                            <li
                              key={decision.id}
                              className="border-border rounded-md border p-3 text-sm"
                            >
                              <p className="truncate font-medium">
                                {decision.title ?? decision.id}
                              </p>
                              <p className="text-muted-foreground mt-1 text-xs">
                                {decision.summary ?? decision.thesis ?? "Decision recorded."}
                              </p>
                              <CopyId label="Decision id" value={decision.id} />
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <EmptyPanelText>No decision records attached to this run.</EmptyPanelText>
                      )}
                    </DetailsBlock>

                    {selectedRunSnapshot.childRuns?.length ? (
                      <DetailsBlock title="Snapshot child runs">
                        <ol className="space-y-2">
                          {selectedRunSnapshot.childRuns.slice(0, 8).map((childRun) => (
                            <li
                              key={childRun.id}
                              className="border-border rounded-md border p-3 text-sm"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <span className="min-w-0">
                                  <span className="block truncate font-medium">
                                    {childRun.id ?? "child run"}
                                  </span>
                                  <span className="text-muted-foreground block text-xs">
                                    {childRun.stage ?? "stage unknown"} /{" "}
                                    {childRun.engine ?? "engine unknown"} /{" "}
                                    {formatAge(childRun.updatedAt ?? childRun.createdAt)}
                                  </span>
                                </span>
                                <StatusPill
                                  status={childRun.status ?? "unknown"}
                                  tone={childRun.status}
                                />
                              </div>
                            </li>
                          ))}
                        </ol>
                      </DetailsBlock>
                    ) : null}

                    <DetailsBlock title="Snapshot audit events">
                      {selectedRunSnapshot.auditEvents.length ? (
                        <ol className="space-y-2">
                          {selectedRunSnapshot.auditEvents.slice(0, 8).map((event) => (
                            <li
                              key={event.id}
                              className="border-border rounded-md border p-3 text-sm"
                            >
                              <p className="truncate font-medium">
                                {event.action ?? "audit.event"}
                              </p>
                              <p className="text-muted-foreground mt-1 text-xs">
                                {event.summary ?? "Audit event recorded."}
                              </p>
                              <p className="text-muted-foreground/80 mt-1 text-xs">
                                {formatTime(event.createdAt)}
                              </p>
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <EmptyPanelText>No audit events attached to this run.</EmptyPanelText>
                      )}
                    </DetailsBlock>

                    <DetailsBlock title="Selected snapshot JSON">
                      <pre className="bg-muted/50 max-h-72 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
                        {JSON.stringify(snapshotDisplayJson(selectedRunSnapshot), null, 2)}
                      </pre>
                    </DetailsBlock>
                  </div>
                ) : (
                  <EmptyPanelText>No snapshot returned for the selected run.</EmptyPanelText>
                )}
              </DetailsBlock>

              <DetailsBlock title="Artifact metadata" defaultOpen>
                {isLoadingHistory && !historyArtifacts.length ? (
                  <EmptyPanelText>Loading artifact metadata.</EmptyPanelText>
                ) : historyArtifacts.length ? (
                  <ol className="space-y-2">
                    {historyArtifacts.map((artifact) => (
                      <li key={artifact.id} className="border-border rounded-md border p-3 text-sm">
                        <div className="flex items-start justify-between gap-3">
                          <span className="min-w-0">
                            <span className="block truncate font-medium">
                              {artifact.title ?? artifact.id}
                            </span>
                            <span className="text-muted-foreground block text-xs">
                              {artifact.kind ?? "artifact"} / {artifact.mimeType ?? "metadata"} /{" "}
                              {formatBytes(artifact.sizeBytes) ?? "size unknown"}
                            </span>
                            <span className="text-muted-foreground/80 block text-xs">
                              {formatAge(artifact.createdAt)}
                            </span>
                          </span>
                        </div>
                        <p className="text-muted-foreground mt-2 break-all text-xs">
                          {artifact.uri ?? "metadata-only artifact"}
                        </p>
                        <CopyId label="Artifact id" value={artifact.id} />
                      </li>
                    ))}
                  </ol>
                ) : (
                  <EmptyPanelText>
                    Metadata artifacts will appear here after tool runs or callbacks create them.
                  </EmptyPanelText>
                )}
              </DetailsBlock>
            </MonitorSection>

            <DetailsBlock title="Manage" defaultOpen={false}>
              <MonitorSection icon={Building2Icon} title="Workspace & Agents">
                <DetailsBlock title="Workspaces">
                  <StatusRow label="Active workspace" value={summary?.workspace?.name} />
                  <form className="flex gap-2" onSubmit={createWorkspace}>
                    <input
                      className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring min-w-0 flex-1 rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
                      value={workspaceName}
                      onChange={(event) => setWorkspaceName(event.target.value)}
                      placeholder="New workspace name"
                      maxLength={80}
                    />
                    <Button
                      type="submit"
                      size="sm"
                      disabled={
                        isCreatingWorkspace || !workspaceName.trim() || !canManageWorkspaces
                      }
                    >
                      {isCreatingWorkspace ? (
                        <Loader2Icon className="animate-spin" />
                      ) : (
                        <PlusIcon />
                      )}
                      Create
                    </Button>
                  </form>
                  {summary?.workspaces?.length ? (
                    <ol className="space-y-2">
                      {summary.workspaces.map((workspace) => (
                        <li
                          key={workspace.id}
                          className="border-border rounded-md border p-3 text-sm"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{workspace.name}</span>
                              <span className="text-muted-foreground block text-xs">
                                {workspace.isActive ? "active" : "available"}
                                {workspace.isDefault ? " / default" : ""}
                              </span>
                            </span>
                            {workspace.isActive ? (
                              <StatusPill status="active" tone="completed" />
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => void activateWorkspace(workspace.id)}
                                disabled={
                                  activatingWorkspaceId === workspace.id || !canManageWorkspaces
                                }
                              >
                                {activatingWorkspaceId === workspace.id ? (
                                  <Loader2Icon className="animate-spin" />
                                ) : null}
                                Make active
                              </Button>
                            )}
                          </div>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <EmptyPanelText>No account workspaces loaded.</EmptyPanelText>
                  )}
                </DetailsBlock>

                <DetailsBlock title="Agents">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <StatusRow label="Active agent" value={summary?.activeAgent?.name} />
                    <StatusRow label="Profile" value={summary?.activeAgent?.profile} />
                    <StatusRow label="Model" value={summary?.activeAgent?.runtime.model} />
                    <StatusRow label="Model source" value={summary?.activeAgent?.runtime.source} />
                    <StatusRow label="Behavior" value={summary?.activeAgent?.behavior.profile} />
                    <StatusRow
                      label="Behavior source"
                      value={summary?.activeAgent?.behavior.source}
                    />
                  </div>
                  <form className="space-y-2" onSubmit={createAgent}>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
                      <input
                        className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring min-w-0 rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
                        value={agentName}
                        onChange={(event) => setAgentName(event.target.value)}
                        placeholder="New test agent name"
                        maxLength={80}
                      />
                      <select
                        className="border-input bg-background ring-offset-background focus-visible:ring-ring rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
                        value={agentProfile}
                        onChange={(event) => {
                          const nextProfile = event.target.value as
                            | "default"
                            | "analyst"
                            | "operator";
                          setAgentProfile(nextProfile);
                          setAgentBehaviorTemplateId(defaultBehaviorTemplateByProfile[nextProfile]);
                        }}
                      >
                        <option value="analyst">Analyst</option>
                        <option value="operator">Operator</option>
                        <option value="default">Default</option>
                      </select>
                    </div>
                    <select
                      className="border-input bg-background ring-offset-background focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
                      value={agentModel}
                      onChange={(event) =>
                        setAgentModel(event.target.value as (typeof agentModelOptions)[number])
                      }
                    >
                      {agentModelOptions.map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                    <select
                      className="border-input bg-background ring-offset-background focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
                      value={agentBehaviorTemplateId}
                      onChange={(event) =>
                        setAgentBehaviorTemplateId(
                          event.target.value as AgentBehaviorTemplate["id"],
                        )
                      }
                    >
                      {behaviorTemplates.length === 0 ? (
                        <option value={agentBehaviorTemplateId}>
                          Behavior template loading...
                        </option>
                      ) : (
                        behaviorTemplates.map((template) => (
                          <option key={template.id} value={template.id}>
                            {template.name} / {template.version}
                          </option>
                        ))
                      )}
                    </select>
                    <textarea
                      className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring min-h-16 w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
                      value={agentDescription}
                      onChange={(event) => setAgentDescription(event.target.value)}
                      placeholder="Optional description"
                      maxLength={240}
                    />
                    {selectedBehaviorTemplate ? (
                      <DetailsBlock title="Selected behavior template">
                        <StatusRow label="Name" value={selectedBehaviorTemplate.name} />
                        <StatusRow
                          label="Description"
                          value={selectedBehaviorTemplate.description}
                        />
                        <StatusRow label="Version" value={selectedBehaviorTemplate.version} />
                        <StatusRow
                          label="Authoring"
                          value={[
                            selectedBehaviorTemplate.authoring?.kind ?? "built_in_template",
                            selectedBehaviorTemplate.authoring?.source ??
                              "cloudflare-control-plane",
                          ].join(" / ")}
                        />
                        <pre className="bg-muted/50 max-h-48 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
                          {selectedBehaviorTemplate.prompt}
                        </pre>
                      </DetailsBlock>
                    ) : null}
                    <Button
                      type="submit"
                      size="sm"
                      disabled={isCreatingAgent || !agentName.trim() || !canManageAgents}
                    >
                      {isCreatingAgent ? <Loader2Icon className="animate-spin" /> : <PlusIcon />}
                      Create and activate test agent
                    </Button>
                  </form>
                  {summary?.agents.length ? (
                    <ol className="space-y-2">
                      {summary.agents.map((agent) => (
                        <li key={agent.id} className="border-border rounded-md border p-3 text-sm">
                          <div className="flex items-start justify-between gap-2">
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{agent.name}</span>
                              <span className="text-muted-foreground block text-xs">
                                {agent.isActive ? "active" : "available"}
                                {agent.isDefault ? " / default" : ""}
                                {` / ${agent.profile}`}
                              </span>
                              <span className="text-muted-foreground block truncate text-xs">
                                {agent.runtime.provider} / {agent.runtime.model}
                              </span>
                              <span className="text-muted-foreground block truncate text-xs">
                                behavior: {agent.behavior.templateId ?? agent.behavior.profile} /{" "}
                                {agent.behavior.version}
                              </span>
                            </span>
                            {agent.isActive ? (
                              <StatusPill status="active" tone="completed" />
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => void activateAgent(agent.id)}
                                disabled={
                                  activatingAgentId === agent.id ||
                                  !canManageAgents ||
                                  agent.status !== "active"
                                }
                              >
                                {activatingAgentId === agent.id ? (
                                  <Loader2Icon className="animate-spin" />
                                ) : null}
                                Make active
                              </Button>
                            )}
                          </div>
                          {agent.description ? (
                            <p className="text-muted-foreground mt-1 text-xs">
                              {agent.description}
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <EmptyPanelText>No workspace agents loaded.</EmptyPanelText>
                  )}
                </DetailsBlock>
              </MonitorSection>

              <MonitorSection icon={LinkIcon} title="Tools">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <StatusRow
                    label="Registered tools"
                    value={String(summary?.tools?.length ?? 0)}
                    compact
                  />
                  <StatusRow
                    label="Model-visible tools"
                    value={String(summary?.tools?.filter((tool) => tool.modelVisible).length ?? 0)}
                    compact
                  />
                  <StatusRow
                    label="Latest tool"
                    value={latestAdminToolCall?.toolId ?? "none"}
                    compact
                  />
                  <StatusRow
                    label="Latest status"
                    value={latestAdminToolCall?.status ?? "No tool call yet"}
                    compact
                  />
                </div>

                <DetailsBlock title="Approval queue" defaultOpen>
                  {isLoadingApprovals && !approvalQueue.length ? (
                    <EmptyPanelText>Loading approval requests.</EmptyPanelText>
                  ) : approvalQueue.length ? (
                    <div className="space-y-3">
                      {pendingApprovals.length ? (
                        <ol className="space-y-2">
                          {pendingApprovals.map((approval) => {
                            const policyBlocked = approval.currentPolicy?.decision === "block";
                            return (
                              <li
                                key={approval.id}
                                className="border-border rounded-md border p-3 text-sm"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <span className="min-w-0">
                                    <span className="block truncate font-medium">
                                      {approval.input?.url ?? "URL unavailable"}
                                    </span>
                                    <span className="text-muted-foreground block text-xs">
                                      {approval.toolId ?? "unknown tool"} /{" "}
                                      {approval.executionMode ?? "dry_run"} /{" "}
                                      {formatAge(approval.createdAt)}
                                    </span>
                                    {approval.humanIntervention ? (
                                      <span className="text-muted-foreground block text-xs">
                                        Intervention: {approval.humanIntervention.state ?? "parked"}{" "}
                                        /{" "}
                                        {approval.humanIntervention.requiredAction ??
                                          "approve_or_deny"}
                                      </span>
                                    ) : null}
                                    {approval.currentPolicy?.reason ? (
                                      <span
                                        className={
                                          policyBlocked
                                            ? "text-destructive block text-xs"
                                            : "text-muted-foreground block text-xs"
                                        }
                                      >
                                        Policy: {approval.currentPolicy.code ?? "unknown"} -{" "}
                                        {approval.currentPolicy.reason}
                                      </span>
                                    ) : null}
                                  </span>
                                  <StatusPill
                                    status={approval.status ?? "requested"}
                                    tone={approvalTone(approval.status)}
                                  />
                                </div>
                                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                                  <CopyId label="Approval id" value={approval.id ?? ""} />
                                  <CopyId label="Run id" value={approval.runId ?? ""} />
                                </div>
                                <div className="mt-2 flex justify-end gap-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={
                                      updatingApprovalId === approval.id || !canManageAgents
                                    }
                                    onClick={() => openApprovalDialog(approval, "deny")}
                                  >
                                    {updatingApprovalId === approval.id ? (
                                      <Loader2Icon className="animate-spin" />
                                    ) : (
                                      <ShieldCheckIcon />
                                    )}
                                    Deny
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    disabled={
                                      updatingApprovalId === approval.id ||
                                      !canManageAgents ||
                                      policyBlocked
                                    }
                                    onClick={() => openApprovalDialog(approval, "approve")}
                                  >
                                    {updatingApprovalId === approval.id ? (
                                      <Loader2Icon className="animate-spin" />
                                    ) : (
                                      <PlayIcon />
                                    )}
                                    Approve
                                  </Button>
                                </div>
                              </li>
                            );
                          })}
                        </ol>
                      ) : (
                        <EmptyPanelText>No pending approval requests.</EmptyPanelText>
                      )}
                      {decidedApprovals.length ? (
                        <div className="space-y-2">
                          <p className="text-muted-foreground text-xs font-medium">
                            Recent decided requests
                          </p>
                          <ol className="space-y-2">
                            {decidedApprovals.slice(0, 6).map((approval) => (
                              <li
                                key={approval.id}
                                className="border-border rounded-md border p-3 text-sm"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <span className="min-w-0">
                                    <span className="block truncate font-medium">
                                      {approval.input?.url ?? "URL unavailable"}
                                    </span>
                                    <span className="text-muted-foreground block text-xs">
                                      {approval.toolId ?? "unknown tool"} /{" "}
                                      {formatAge(
                                        approval.decision?.decidedAt ?? approval.updatedAt,
                                      )}
                                    </span>
                                    {approval.decision?.denyReason ? (
                                      <span className="text-muted-foreground block text-xs">
                                        {approval.decision.denyReason}
                                      </span>
                                    ) : null}
                                    {approval.humanIntervention ? (
                                      <span className="text-muted-foreground block text-xs">
                                        Intervention:{" "}
                                        {approval.humanIntervention.state ?? "decided"}
                                      </span>
                                    ) : null}
                                  </span>
                                  <StatusPill
                                    status={approval.status ?? "decided"}
                                    tone={approvalTone(approval.status)}
                                  />
                                </div>
                                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                                  <CopyId label="Approval id" value={approval.id ?? ""} />
                                  <CopyId label="Run id" value={approval.runId ?? ""} />
                                </div>
                              </li>
                            ))}
                          </ol>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <EmptyPanelText>No approval requests for this workspace.</EmptyPanelText>
                  )}
                </DetailsBlock>

                <DetailsBlock title="Registered tools" defaultOpen>
                  {summary?.tools?.length ? (
                    <ol className="space-y-2">
                      {summary.tools.map((tool) => (
                        <li key={tool.name} className="border-border rounded-md border p-3 text-sm">
                          <div className="flex items-start justify-between gap-3">
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{tool.name}</span>
                              <span className="text-muted-foreground block text-xs">
                                {tool.family} / {tool.kind} / {tool.mutationRisk}
                              </span>
                              <span className="text-muted-foreground block text-xs">
                                modes:{" "}
                                {(tool.allowedExecutionModes ?? tool.supportedExecutionModes).join(
                                  ", ",
                                )}
                              </span>
                              <span className="text-muted-foreground block text-xs">
                                policy: {tool.policyReference ?? "none"}
                              </span>
                              {tool.runner?.sandbox ? (
                                <span className="text-muted-foreground block text-xs">
                                  sandbox: {tool.runner.sandbox.lifecycle?.template ?? "unknown"} /{" "}
                                  {tool.runner.sandbox.network?.egress ?? "egress"} /{" "}
                                  {tool.runner.sandbox.network?.privateNetwork ?? "private"}
                                </span>
                              ) : null}
                              {tool.connectionAuth ? (
                                <span className="text-muted-foreground block text-xs">
                                  connection: {tool.connectionAuth.status ?? "unknown"} /{" "}
                                  {tool.connectionAuth.principal ?? "none"} /{" "}
                                  {tool.connectionAuth.approvalOrder ?? "policy"}
                                </span>
                              ) : null}
                            </span>
                            <span className="flex shrink-0 flex-col items-end gap-1">
                              <StatusPill
                                status={tool.permissionStatus ?? "unseeded"}
                                tone={tool.permissionStatus === "enabled" ? "completed" : undefined}
                              />
                              <StatusPill
                                status={tool.adminVisible ? "Admin" : "Hidden"}
                                tone={tool.adminVisible ? "completed" : undefined}
                              />
                              <StatusPill
                                status={tool.approvalRequired ? "Approval required" : "No approval"}
                                tone={tool.approvalRequired ? "running" : "completed"}
                              />
                              <StatusPill
                                status={tool.modelVisible ? "Model" : "Not model-visible"}
                                tone={tool.modelVisible ? "completed" : undefined}
                              />
                            </span>
                          </div>
                          <p className="text-muted-foreground mt-2 text-xs">{tool.reason}</p>
                          {tool.capability ? (
                            <p className="text-muted-foreground mt-1 text-xs">
                              Capability: {tool.capability.decision} /{" "}
                              {tool.capability.code ?? "unknown"} for{" "}
                              {summary.capabilityContext?.surface ?? "model_exposure"} (
                              {summary.capabilityContext?.stage ?? "observe"},{" "}
                              {summary.capabilityContext?.executionMode ?? "dry_run"})
                            </p>
                          ) : null}
                          {tool.adminPolicy?.reason ? (
                            <p className="text-muted-foreground mt-1 text-xs">
                              Admin policy: {tool.adminPolicy.code ?? "unknown"} -{" "}
                              {tool.adminPolicy.reason}
                            </p>
                          ) : null}
                          {tool.modelExposurePolicy?.reason ? (
                            <p className="text-muted-foreground mt-1 text-xs">
                              Model exposure: {tool.modelExposurePolicy.code ?? "unknown"} -{" "}
                              {tool.modelExposurePolicy.reason}
                            </p>
                          ) : null}
                          {tool.killSwitchReason ? (
                            <p className="text-destructive mt-1 text-xs">{tool.killSwitchReason}</p>
                          ) : null}
                          {tool.latestApprovalRequest ? (
                            <div className="border-border bg-muted/30 mt-2 rounded-md border p-2 text-xs">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium">Latest approval request</span>
                                <StatusPill
                                  status={tool.latestApprovalRequest.status ?? "requested"}
                                  tone={
                                    tool.latestApprovalRequest.status === "approved" ||
                                    tool.latestApprovalRequest.status === "denied"
                                      ? "completed"
                                      : "running"
                                  }
                                />
                              </div>
                              <p className="text-muted-foreground mt-1">
                                {tool.latestApprovalRequest.reason ?? "Approval requested."}
                              </p>
                              <CopyId
                                label="Approval id"
                                value={tool.latestApprovalRequest.id ?? ""}
                              />
                            </div>
                          ) : null}
                          {tool.name === "url.inspect" ? (
                            <div className="mt-3 flex flex-wrap justify-end gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={
                                  updatingToolPolicy === tool.name ||
                                  !canManageAgents ||
                                  tool.approvalRequired
                                }
                                onClick={() =>
                                  updateUrlInspectPolicy({
                                    modelVisible: !tool.modelVisible,
                                  })
                                }
                              >
                                {updatingToolPolicy === tool.name ? (
                                  <Loader2Icon className="animate-spin" />
                                ) : (
                                  <MessageSquareIcon />
                                )}
                                {tool.modelVisible ? "Hide from model" : "Expose to model"}
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={updatingToolPolicy === tool.name || !canManageAgents}
                                onClick={() =>
                                  updateUrlInspectPolicy({
                                    requiresApproval: !tool.approvalRequired,
                                  })
                                }
                              >
                                {updatingToolPolicy === tool.name ? (
                                  <Loader2Icon className="animate-spin" />
                                ) : (
                                  <ShieldCheckIcon />
                                )}
                                {tool.approvalRequired ? "Clear approval" : "Require approval"}
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={updatingToolPolicy === tool.name || !canManageAgents}
                                onClick={() =>
                                  updateUrlInspectPolicy({
                                    status:
                                      tool.permissionStatus === "enabled" ? "disabled" : "enabled",
                                    killSwitchReason:
                                      tool.permissionStatus === "enabled"
                                        ? "Disabled by workspace admin policy."
                                        : undefined,
                                  })
                                }
                              >
                                {updatingToolPolicy === tool.name ? (
                                  <Loader2Icon className="animate-spin" />
                                ) : (
                                  <ShieldCheckIcon />
                                )}
                                {tool.permissionStatus === "enabled" ? "Disable" : "Enable"}
                              </Button>
                            </div>
                          ) : null}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <EmptyPanelText>No tools loaded for this workspace.</EmptyPanelText>
                  )}
                </DetailsBlock>

                <DetailsBlock title="URL Inspector">
                  <form className="space-y-2" onSubmit={runUrlInspect}>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
                      <input
                        className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring min-w-0 rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
                        value={urlInspectTarget}
                        onChange={(event) => setUrlInspectTarget(event.target.value)}
                        placeholder="https://example.com"
                        inputMode="url"
                      />
                      <Button
                        type="submit"
                        size="sm"
                        disabled={
                          isRunningTool ||
                          !urlInspectTarget.trim() ||
                          !canManageAgents ||
                          urlInspectTool?.permissionStatus === "disabled"
                        }
                      >
                        {isRunningTool ? <Loader2Icon className="animate-spin" /> : <LinkIcon />}
                        Inspect URL
                      </Button>
                    </div>
                    <p className="text-muted-foreground text-xs">
                      Read-only dry-run tool. Local, private, and metadata hosts are blocked.
                    </p>
                  </form>
                </DetailsBlock>

                <DetailsBlock title="Recent tool calls">
                  {summary?.latestToolCalls?.length ? (
                    <ol className="space-y-2">
                      {summary.latestToolCalls.slice(0, 6).map((toolCall) => (
                        <li
                          key={toolCall.id}
                          className="border-border rounded-md border p-3 text-sm"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{toolCall.toolId}</span>
                              <span className="text-muted-foreground block text-xs">
                                {toolCall.outputSummary ??
                                  toolCall.inputSummary ??
                                  "Tool call recorded"}
                              </span>
                              <span className="text-muted-foreground/80 block truncate text-xs">
                                {formatTime(toolCall.finishedAt ?? toolCall.startedAt)}
                              </span>
                            </span>
                            <StatusPill
                              status={toolCall.status ?? "unknown"}
                              tone={toolCall.status}
                            />
                          </div>
                          <CopyId label="Tool call id" value={toolCall.id} />
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <EmptyPanelText>
                      Run the URL inspector or diagnostic to populate tool calls.
                    </EmptyPanelText>
                  )}
                </DetailsBlock>

                {latestAdminArtifact ? (
                  <RuntimeRecord
                    icon={FileTextIcon}
                    label="Latest tool artifact"
                    title={latestAdminArtifact.title ?? latestAdminArtifact.id}
                    detail={latestAdminArtifact.uri}
                  />
                ) : null}
              </MonitorSection>

              <MonitorSection icon={WrenchIcon} title="Diagnostic Run">
                <div className="flex items-center justify-between gap-3">
                  <StatusPill status={`demo run: ${run?.status ?? "idle"}`} tone={run?.status} />
                  <Button size="sm" onClick={startDemoRun} disabled={isStarting || isDemoActive}>
                    {isStarting ? <Loader2Icon className="animate-spin" /> : <PlayIcon />}
                    Run diagnostic
                  </Button>
                </div>
                <DetailsBlock title="Diagnostic details">
                  <div className="grid grid-cols-2 gap-2">
                    <StatusRow label="Mode" value={run?.execution?.mode ?? "dry_run"} compact />
                    <StatusRow label="Stage" value={run?.stage ?? "observe"} compact />
                    <StatusRow
                      label="Intent"
                      value={demoSnapshot?.intent?.type ?? "not created"}
                      compact
                    />
                    <StatusRow label="Updated" value={formatTime(run?.updatedAt)} compact />
                  </div>
                  <RuntimeRecord
                    icon={WrenchIcon}
                    label="Tool call"
                    title={latestToolCall?.toolId ?? "none yet"}
                    detail={latestToolCall?.outputSummary ?? latestToolCall?.inputSummary}
                    status={latestToolCall?.status}
                  />
                  <RuntimeRecord
                    icon={FileTextIcon}
                    label="Artifact"
                    title={latestArtifact?.title ?? "none yet"}
                    detail={latestArtifact?.uri}
                  />
                  <RuntimeRecord
                    icon={ShieldCheckIcon}
                    label="Decision"
                    title={latestDecision?.title ?? "none yet"}
                    detail={latestDecision?.summary}
                  />
                  {demoSnapshot?.childRuns?.length ? (
                    <div className="border-border rounded-md border p-3">
                      <p className="text-muted-foreground text-xs">Child runs</p>
                      <ol className="mt-2 space-y-2">
                        {demoSnapshot.childRuns.slice(0, 4).map((childRun) => (
                          <li key={childRun.id} className="space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-sm font-medium">
                                {childRun.id ?? "child run"}
                              </span>
                              <StatusPill
                                status={childRun.status ?? "unknown"}
                                tone={childRun.status}
                              />
                            </div>
                            <StatusRow
                              label="Relation"
                              value={[
                                childRun.relation?.kind ?? "child",
                                childRun.relation?.depth !== undefined
                                  ? `depth ${childRun.relation.depth}`
                                  : null,
                              ]
                                .filter(Boolean)
                                .join(" / ")}
                              compact
                            />
                          </li>
                        ))}
                      </ol>
                    </div>
                  ) : null}
                </DetailsBlock>
              </MonitorSection>
            </DetailsBlock>

            <DetailsBlock title="Advanced" defaultOpen={false}>
              <MonitorSection icon={AlertCircleIcon} title="Advanced Details">
                <DetailsBlock title="Raw scope ids">
                  <CopyId label="Trace id" value={latestTrace?.traceId} />
                  <CopyId label="Bottleneck span id" value={latestTrace?.bottleneckSpanId} />
                  <CopyId label="User id" value={summary?.identity.userId} />
                  <CopyId label="Account id" value={summary?.account?.id} />
                  <CopyId label="Workspace id" value={summary?.identity.workspaceId} />
                  <CopyId label="Active agent id" value={summary?.identity.agentId} />
                  <CopyId label="Session id" value={chatRuntime?.latestSession?.sessionId} />
                  <CopyId label="Thread id" value={chatRuntime?.latestThread?.threadId} />
                  <CopyId label="Chat intent id" value={chatRuntime?.latestIntent?.id} />
                  <CopyId label="Policy id" value={chatRuntime?.latestPolicyDecision?.id} />
                  <CopyId label="Chat run id" value={chatRuntime?.latestRun?.id} />
                  <CopyId label="External run id" value={chatRuntime?.latestRun?.upstreamRunId} />
                  <CopyId label="Demo run id" value={run?.id} />
                </DetailsBlock>

                <DetailsBlock title="Runtime trace JSON">
                  {latestTrace ? (
                    <pre className="bg-muted/50 max-h-72 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
                      {JSON.stringify({ trace: latestTrace, spans: traceWaterfall }, null, 2)}
                    </pre>
                  ) : (
                    <EmptyPanelText>No runtime trace loaded yet.</EmptyPanelText>
                  )}
                </DetailsBlock>

                <DetailsBlock title="Agent runtime config">
                  <StatusRow label="Provider" value={summary?.activeAgent?.runtime.provider} />
                  <CopyId label="Model" value={summary?.activeAgent?.runtime.model} />
                  <StatusRow
                    label="Temperature"
                    value={String(summary?.activeAgent?.runtime.temperature ?? "")}
                  />
                  <StatusRow
                    label="Max tokens"
                    value={String(summary?.activeAgent?.runtime.maxTokens ?? "")}
                  />
                  <StatusRow label="Source" value={summary?.activeAgent?.runtime.source} />
                </DetailsBlock>

                <DetailsBlock title="Chat runtime timings">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <StatusRow
                      label="Pre-stream"
                      value={formatDuration(chatRuntime?.timings?.preStreamMs)}
                      compact
                    />
                    <StatusRow
                      label="First token"
                      value={formatDuration(chatRuntime?.timings?.firstTokenMs)}
                      compact
                    />
                    <StatusRow
                      label="Provider"
                      value={formatDuration(chatRuntime?.timings?.providerMs)}
                      compact
                    />
                    <StatusRow
                      label="Total"
                      value={formatDuration(chatRuntime?.timings?.totalMs)}
                      compact
                    />
                  </div>
                  {chatRuntime?.timings?.stageMarks &&
                  Object.keys(chatRuntime.timings.stageMarks).length > 0 ? (
                    <div className="space-y-2">
                      {Object.entries(chatRuntime.timings.stageMarks).map(([stage, value]) => (
                        <StatusRow
                          key={stage}
                          label={stage}
                          value={formatDuration(value)}
                          compact
                        />
                      ))}
                    </div>
                  ) : (
                    <EmptyPanelText>
                      Send a message to populate Cloudflare timing marks.
                    </EmptyPanelText>
                  )}
                </DetailsBlock>

                <DetailsBlock title="Tool internals">
                  <CopyId label="Latest tool call id" value={latestAdminToolCall?.id} />
                  <CopyId label="Latest tool run id" value={latestAdminToolCall?.runId} />
                  <CopyId label="Latest tool artifact id" value={latestAdminArtifact?.id} />
                  {latestAdminToolCall ? (
                    <pre className="bg-muted/50 max-h-72 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
                      {JSON.stringify(latestAdminToolCall, null, 2)}
                    </pre>
                  ) : (
                    <EmptyPanelText>No tool call internals recorded yet.</EmptyPanelText>
                  )}
                  {latestAdminArtifact?.data ? (
                    <pre className="bg-muted/50 max-h-72 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
                      {JSON.stringify(latestAdminArtifact.data, null, 2)}
                    </pre>
                  ) : null}
                </DetailsBlock>

                <DetailsBlock title="Agent behavior config">
                  <StatusRow label="Profile" value={summary?.activeAgent?.behavior.profile} />
                  <StatusRow label="Source" value={summary?.activeAgent?.behavior.source} />
                  <StatusRow label="Format" value={summary?.activeAgent?.behavior.format} />
                  <StatusRow label="Template" value={summary?.activeAgent?.behavior.templateId} />
                  <StatusRow
                    label="Authoring"
                    value={
                      summary?.activeAgent?.behavior.authoring
                        ? [
                            summary.activeAgent.behavior.authoring.kind,
                            summary.activeAgent.behavior.authoring.source,
                          ]
                            .filter(Boolean)
                            .join(" / ")
                        : undefined
                    }
                  />
                  <StatusRow label="Version" value={summary?.activeAgent?.behavior.version} />
                  <CopyId
                    label="Instruction id"
                    value={summary?.activeAgent?.behavior.instructionId}
                  />
                  {summary?.activeAgent?.behavior.preview ? (
                    <pre className="bg-muted/50 max-h-72 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
                      {summary.activeAgent.behavior.preview}
                    </pre>
                  ) : (
                    <EmptyPanelText>
                      This agent is using the legacy server preset fallback.
                    </EmptyPanelText>
                  )}
                </DetailsBlock>

                <DetailsBlock title="Membership and external identity">
                  <StatusRow label="Auth mode" value={summary?.identity.authMode} />
                  <StatusRow label="Account source" value={summary?.account?.source} />
                  <StatusRow label="Membership source" value={summary?.membership?.source} />
                  <StatusRow label="Roles" value={listValue(summary?.membership?.roles)} />
                  <StatusRow
                    label="Permissions"
                    value={listValue(summary?.membership?.permissions)}
                  />
                  {summary?.externalMembership ? (
                    <div className="border-border rounded-md border p-3">
                      <p className="text-muted-foreground text-xs">External WorkOS signal</p>
                      <StatusRow
                        label="Role / status"
                        value={[
                          summary.externalMembership.role ?? "not available",
                          summary.externalMembership.status ?? "not available",
                        ].join(" / ")}
                        compact
                      />
                      <StatusRow
                        label="Roles"
                        value={listValue(summary.externalMembership.roles)}
                        compact
                      />
                      <StatusRow
                        label="Permissions"
                        value={listValue(summary.externalMembership.permissions)}
                        compact
                      />
                    </div>
                  ) : null}
                </DetailsBlock>

                <DetailsBlock title="Cloudflare events">
                  {summary?.events.length ? (
                    <ol className="space-y-3">
                      {summary.events.slice(0, 12).map((event) => (
                        <li key={event.id} className="grid grid-cols-[0.75rem_1fr] gap-3 text-sm">
                          <span className="bg-primary mt-1.5 size-2 rounded-full" />
                          <span className="min-w-0">
                            <span className="block truncate font-medium">
                              {event.type ?? "control.event"}
                            </span>
                            <span className="text-muted-foreground block">
                              {event.summary ?? "Control-plane event recorded."}
                            </span>
                            <span className="text-muted-foreground/80 block truncate text-xs">
                              {formatTime(event.createdAt)}
                              {event.targetType ? ` / ${event.targetType}` : ""}
                            </span>
                            <CopyId label="Event id" value={event.id} />
                          </span>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <EmptyPanelText>
                      Open chat or run the diagnostic to populate events.
                    </EmptyPanelText>
                  )}
                </DetailsBlock>

                <DetailsBlock title="Error internals" defaultOpen={Boolean(importantError)}>
                  {importantError ? (
                    <div className="border-destructive/30 bg-destructive/10 rounded-md border p-3 text-sm">
                      <p className="text-destructive font-medium">{importantError.message}</p>
                      <p className="text-muted-foreground mt-1 text-xs">
                        {importantError.source}
                        {importantError.status ? ` / ${importantError.status}` : ""}
                        {importantError.errorCode ? ` / ${importantError.errorCode}` : ""}
                      </p>
                      <CopyId label="Error target id" value={importantError.targetId} />
                    </div>
                  ) : (
                    <EmptyPanelText>No Cloudflare-owned error found for this scope.</EmptyPanelText>
                  )}
                </DetailsBlock>
              </MonitorSection>
            </DetailsBlock>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(approvalDialog)}
        onOpenChange={(nextOpen) => !nextOpen && setApprovalDialog(null)}
      >
        <DialogContent className="max-w-lg" aria-describedby="approval-dialog-description">
          <DialogHeader>
            <DialogTitle>
              {approvalDialog?.action === "approve" ? "Approve URL inspection" : "Deny approval"}
            </DialogTitle>
            <DialogDescription id="approval-dialog-description">
              Review the original request and current policy state before deciding.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="border-border rounded-md border p-3">
              <p className="text-muted-foreground text-xs">Original URL</p>
              <p className="mt-1 break-all font-medium">
                {approvalDialog?.approval.input?.url ?? "URL unavailable"}
              </p>
            </div>
            <div className="border-border rounded-md border p-3">
              <p className="text-muted-foreground text-xs">Current policy</p>
              <p
                className={
                  selectedApprovalPolicyBlocked
                    ? "text-destructive mt-1"
                    : "text-muted-foreground mt-1"
                }
              >
                {selectedApprovalPolicy
                  ? `${selectedApprovalPolicy.code ?? "unknown"} - ${
                      selectedApprovalPolicy.reason ?? "No policy reason returned."
                    }`
                  : "Policy will be checked by the control plane before execution."}
              </p>
            </div>
            {approvalDialog?.action === "deny" ? (
              <label className="block space-y-1">
                <span className="text-muted-foreground text-xs">Deny reason</span>
                <textarea
                  className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring min-h-20 w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
                  value={denyReason}
                  onChange={(event) => setDenyReason(event.target.value)}
                  placeholder="Denied from Admin Tools."
                />
              </label>
            ) : null}
            {approvalDialog?.action === "approve" && selectedApprovalPolicyBlocked ? (
              <p className="text-destructive text-xs">
                This request cannot be approved until the policy block is cleared. Deny remains
                available from the queue.
              </p>
            ) : null}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setApprovalDialog(null)}
              disabled={Boolean(updatingApprovalId)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={confirmApprovalDialog}
              disabled={
                !approvalDialog?.approval.id ||
                Boolean(updatingApprovalId) ||
                (approvalDialog?.action === "approve" && selectedApprovalPolicyBlocked)
              }
            >
              {updatingApprovalId ? <Loader2Icon className="animate-spin" /> : null}
              {approvalDialog?.action === "approve" ? "Approve and run" : "Deny request"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
