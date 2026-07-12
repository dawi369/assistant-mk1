"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ActivityIcon,
  AlertCircleIcon,
  BotIcon,
  BoxIcon,
  CheckIcon,
  ExternalLinkIcon,
  FileClockIcon,
  FlaskConicalIcon,
  Loader2Icon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  WrenchIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CopyId,
  EmptyPanelText,
  formatTime,
  StatusPill,
  StatusRow,
} from "@/components/workbench/dev-monitor-primitives";
import { resolveAdminAgentPackState } from "@/lib/workbench/admin-agent-packs";
import { requestWorkbenchSummaryRefresh } from "@/lib/workbench/admin-summary-events";
import { deriveRuntimeState } from "@/lib/workbench/chat-runtime-live-state";
import { readJsonResponse } from "@/lib/workbench/read-json-response";
import { useAdminSummaryResource } from "@/lib/workbench/use-admin-summary-resource";
import { useWorkbenchAgentConnection } from "@/lib/workbench/use-agent-connection";
import type {
  AgentBehaviorTemplate,
  AgentSummary,
  CloudflareAgentBehaviorTemplatesResponse,
  CloudflareToolApprovalActionResponse,
  CloudflareToolApprovalsResponse,
  CloudflareToolPolicyUpdateResponse,
  CloudflareToolRunResponse,
  ToolApprovalRequestSummary,
  ToolSummary,
} from "@/lib/workbench/workbench-types";
import { WorkbenchAutomationsPanel } from "@/components/workbench/workbench-automations-panel";

const behaviorTemplatesPath = "/api/workbench/agent-behavior-templates";
const agentsPath = "/api/workbench/agents";
const toolRunsPath = "/api/workbench/tools/runs";
const toolPolicyPath = "/api/workbench/tools/policy";
const toolApprovalsPath = "/api/workbench/tools/approvals";

const packStateLabel = {
  current: "Current",
  ready: "Ready",
  update_available: "Update available",
  not_instantiated: "Not instantiated",
} as const;

const sectionClass = "border-border rounded-lg border bg-background";
const inputClass =
  "border-input bg-background h-9 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function AdminPanel({
  open,
  onOpenChange,
  onCloseAutoFocus,
  onOpenWorkspace,
  onOpenAgents,
  onOpenHistory,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
  onOpenWorkspace: () => void;
  onOpenAgents: () => void;
  onOpenHistory: (runId?: string) => void;
}) {
  const {
    connection,
    error: sessionError,
    session,
    pending,
    isInitialLoading,
    isSessionStreamConnected,
    latestSessionEvent,
    switchAgent,
  } = useWorkbenchAgentConnection();
  const {
    summary,
    error: summaryError,
    isLoading,
    refreshSummary,
    setProjectionPreference,
  } = useAdminSummaryResource();
  const [templates, setTemplates] = useState<AgentBehaviorTemplate[]>([]);
  const [approvals, setApprovals] = useState<ToolApprovalRequestSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyPackId, setBusyPackId] = useState<string | null>(null);
  const [busyTool, setBusyTool] = useState<string | null>(null);
  const [busyApprovalId, setBusyApprovalId] = useState<string | null>(null);
  const [approvalDialog, setApprovalDialog] = useState<{
    approval: ToolApprovalRequestSummary;
    action: "approve" | "deny";
  } | null>(null);
  const [denyReason, setDenyReason] = useState("");
  const [customAgentOpen, setCustomAgentOpen] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customDescription, setCustomDescription] = useState("");
  const [customTemplateId, setCustomTemplateId] = useState("assistant-analyst");
  const [urlTarget, setUrlTarget] = useState("");

  const loadSecondaryData = async () => {
    try {
      const [templateResponse, approvalResponse] = await Promise.all([
        fetch(behaviorTemplatesPath, { cache: "no-store" }),
        fetch(`${toolApprovalsPath}?status=all&limit=20`, { cache: "no-store" }),
      ]);
      const [templateBody, approvalBody] = await Promise.all([
        readJsonResponse<CloudflareAgentBehaviorTemplatesResponse>(
          templateResponse,
          "Failed to load agent packs",
        ),
        readJsonResponse<CloudflareToolApprovalsResponse>(
          approvalResponse,
          "Failed to load approvals",
        ),
      ]);
      setTemplates(templateBody.templates ?? []);
      setApprovals(approvalBody.approvals ?? []);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load Admin data");
    }
  };

  const refresh = async (force = false) => {
    await Promise.all([
      refreshSummary({ source: "manual", force, projection: "drawer" }),
      loadSecondaryData(),
    ]);
  };

  useEffect(() => {
    if (!open) return;
    setProjectionPreference("drawer");
    void refreshSummary({ source: "drawer-open", projection: "drawer" });
    void loadSecondaryData();
    return () => setProjectionPreference("compact");
  }, [open, refreshSummary, setProjectionPreference]);

  const liveRuntime = deriveRuntimeState({
    session,
    connection,
    error: sessionError,
    isSessionStreamConnected,
    latestSessionEvent,
    pending,
    isInitialLoading,
    summary,
    summaryError,
  });
  const packTemplates = useMemo(() => templates.filter((template) => template.pack), [templates]);
  const pendingApprovals = approvals.filter((approval) => approval.status === "requested");
  const importantError =
    error ?? summaryError ?? liveRuntime.errorMessage ?? summary?.lastError?.message;
  const currentPack =
    session?.activeAgent?.behavior.pack ?? summary?.activeAgent?.behavior.pack ?? null;
  const canManageAutomations = ["owner", "admin"].includes(
    summary?.membership?.role?.toLowerCase() ?? "",
  );

  const usePack = async (template: AgentBehaviorTemplate) => {
    if (!template.pack) return;
    setBusyPackId(template.pack.id);
    setError(null);
    try {
      const result = await readJsonResponse<{ agent: AgentSummary }>(
        await fetch(
          `/api/workbench/agent-packs/${encodeURIComponent(template.pack.id)}/instantiate`,
          { method: "POST" },
        ),
        "Failed to prepare agent pack",
      );
      await switchAgent(result.agent.id, "new_thread");
      requestWorkbenchSummaryRefresh({ source: "event" });
      onOpenChange(false);
    } catch (activationError) {
      setError(
        activationError instanceof Error
          ? activationError.message
          : "Failed to activate agent pack",
      );
    } finally {
      setBusyPackId(null);
    }
  };

  const updateToolPolicy = async (tool: ToolSummary, change: Record<string, string | boolean>) => {
    setBusyTool(tool.name);
    setError(null);
    try {
      await readJsonResponse<CloudflareToolPolicyUpdateResponse>(
        await fetch(toolPolicyPath, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ toolName: tool.name, ...change }),
        }),
        `Failed to update ${tool.name}`,
      );
      await refresh(true);
    } catch (policyError) {
      setError(policyError instanceof Error ? policyError.message : "Failed to update tool policy");
    } finally {
      setBusyTool(null);
    }
  };

  const decideApproval = async () => {
    const approval = approvalDialog?.approval;
    if (!approval?.id || !approvalDialog) return;
    setBusyApprovalId(approval.id);
    setError(null);
    try {
      const suffix = approvalDialog.action === "approve" ? "approve" : "deny";
      await readJsonResponse<CloudflareToolApprovalActionResponse>(
        await fetch(`${toolApprovalsPath}/${encodeURIComponent(approval.id)}/${suffix}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body:
            approvalDialog.action === "deny"
              ? JSON.stringify({ reason: denyReason.trim() || "Denied by an operator." })
              : undefined,
        }),
        `Failed to ${approvalDialog.action} request`,
      );
      setApprovalDialog(null);
      setDenyReason("");
      await refresh(true);
    } catch (approvalError) {
      setError(
        approvalError instanceof Error ? approvalError.message : "Failed to update approval",
      );
    } finally {
      setBusyApprovalId(null);
    }
  };

  const runDiagnostic = async (toolName: string, input: Record<string, unknown> = {}) => {
    setBusyTool(toolName);
    setError(null);
    try {
      await readJsonResponse<CloudflareToolRunResponse>(
        await fetch(toolRunsPath, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ toolName, executionMode: "dry_run", input }),
        }),
        `Failed to run ${toolName}`,
      );
      await refresh(true);
    } catch (diagnosticError) {
      setError(
        diagnosticError instanceof Error ? diagnosticError.message : `Failed to run ${toolName}`,
      );
    } finally {
      setBusyTool(null);
    }
  };

  const createCustomAgent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const template = templates.find((candidate) => candidate.id === customTemplateId);
    if (!template || !customName.trim()) return;
    setBusyTool("custom-agent");
    setError(null);
    try {
      await readJsonResponse(
        await fetch(agentsPath, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: customName.trim(),
            description: customDescription.trim() || undefined,
            profile: template.profile,
            behaviorTemplateId: template.id,
            activate: false,
          }),
        }),
        "Failed to create custom agent",
      );
      setCustomAgentOpen(false);
      setCustomName("");
      setCustomDescription("");
      await refresh(true);
    } catch (createError) {
      setError(
        createError instanceof Error ? createError.message : "Failed to create custom agent",
      );
    } finally {
      setBusyTool(null);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="grid h-[min(88vh,58rem)] w-[min(92vw,72rem)] max-w-[calc(100vw-1rem)] grid-rows-[auto_auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-[min(92vw,72rem)]"
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <DialogHeader className="border-border border-b px-5 py-4">
            <div className="flex items-center justify-between gap-4 pr-8">
              <div>
                <DialogTitle className="flex items-center gap-2 text-base">
                  <ShieldCheckIcon className="text-muted-foreground size-4" />
                  Admin
                </DialogTitle>
                <DialogDescription className="mt-1">
                  Operate agent packs, approvals, tools, and runtime diagnostics.
                </DialogDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void refresh(true)}
                disabled={isLoading}
              >
                {isLoading ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
                Refresh
              </Button>
            </div>
          </DialogHeader>

          {importantError ? (
            <div className="border-destructive/30 bg-destructive/5 text-destructive flex items-center gap-2 border-b px-5 py-2 text-xs">
              <AlertCircleIcon className="size-3.5 shrink-0" />
              <span className="min-w-0 truncate">{importantError}</span>
            </div>
          ) : (
            <div className="border-border text-muted-foreground border-b px-5 py-2 text-xs">
              Updated {formatTime(summary?.generatedAt)}
            </div>
          )}

          <Tabs defaultValue="overview" className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
            <div className="border-border overflow-x-auto border-b px-4 py-2">
              <TabsList>
                <TabsTrigger value="overview">
                  <ActivityIcon />
                  Overview
                </TabsTrigger>
                <TabsTrigger value="packs">
                  <BoxIcon />
                  Agents & Packs
                </TabsTrigger>
                <TabsTrigger value="tools">
                  <SlidersHorizontalIcon />
                  Tools & Approvals
                </TabsTrigger>
                <TabsTrigger value="diagnostics">
                  <FlaskConicalIcon />
                  Diagnostics
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="overview" className="overflow-y-auto p-5">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(18rem,.7fr)]">
                <section className={`${sectionClass} p-4`}>
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold">Current environment</h2>
                    <StatusPill status={liveRuntime.chatLabel} tone={liveRuntime.chatTone} />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <StatusRow
                      label="Workspace"
                      value={session?.workspace?.name ?? summary?.workspace?.name}
                      compact
                      tone="ok"
                    />
                    <StatusRow
                      label="Agent"
                      value={session?.activeAgent?.name ?? summary?.activeAgent?.name}
                      compact
                      tone="ok"
                    />
                    <StatusRow
                      label="Pack"
                      value={
                        session?.activeAgent?.behavior.pack?.name ??
                        session?.activeAgent?.behavior.pack?.id ??
                        summary?.activeAgent?.behavior.pack?.name ??
                        summary?.activeAgent?.behavior.pack?.id
                      }
                      compact
                    />
                    <StatusRow
                      label="Model"
                      value={
                        session?.activeAgent?.runtime.model ?? summary?.activeAgent?.runtime.model
                      }
                      compact
                    />
                    <StatusRow
                      label="Membership"
                      value={
                        summary?.membership
                          ? `${summary.membership.role} / ${summary.membership.status}`
                          : undefined
                      }
                      compact
                    />
                    <StatusRow
                      label="Connection"
                      value={connection ? "Live token available" : "Connecting"}
                      compact
                    />
                  </div>
                </section>
                <section className={`${sectionClass} p-4`}>
                  <h2 className="text-sm font-semibold">Product surfaces</h2>
                  <p className="text-muted-foreground mt-1 text-xs">
                    Use the dedicated interfaces for normal workspace operations.
                  </p>
                  <div className="mt-4 grid gap-2">
                    <Button variant="outline" className="justify-between" onClick={onOpenWorkspace}>
                      Workspace <ExternalLinkIcon />
                    </Button>
                    <Button variant="outline" className="justify-between" onClick={onOpenAgents}>
                      Agents <ExternalLinkIcon />
                    </Button>
                    <Button
                      variant="outline"
                      className="justify-between"
                      onClick={() => onOpenHistory()}
                    >
                      History <ExternalLinkIcon />
                    </Button>
                  </div>
                </section>
              </div>
            </TabsContent>

            <TabsContent value="packs" className="overflow-y-auto p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">Installed packs</h2>
                  <p className="text-muted-foreground text-xs">
                    Use the current version without changing existing conversations.
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setCustomAgentOpen(true)}>
                  <PlusIcon />
                  Custom agent
                </Button>
              </div>
              <div className="grid gap-3 lg:grid-cols-3">
                {packTemplates.map((template) => {
                  const state = resolveAdminAgentPackState(
                    template,
                    summary?.agents ?? [],
                    session?.activeAgent?.id ?? summary?.activeAgent?.id,
                  );
                  if (!template.pack || !state) return null;
                  const busy = busyPackId === template.pack.id;
                  return (
                    <article
                      key={template.id}
                      className={`${sectionClass} flex min-h-64 flex-col p-4`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="font-medium">{template.name}</h3>
                          <p className="text-muted-foreground mt-1 text-xs">
                            {template.description}
                          </p>
                        </div>
                        <StatusPill
                          status={packStateLabel[state.state]}
                          tone={state.state === "current" ? "completed" : undefined}
                        />
                      </div>
                      <div className="text-muted-foreground mt-4 space-y-1 text-xs">
                        <p>Version {template.version}</p>
                        <p>
                          {template.pack.tools.length} tools · {template.pack.workflows.length}{" "}
                          workflow{template.pack.workflows.length === 1 ? "" : "s"}
                        </p>
                        <p>
                          {template.pack.risk.externalMutation ? "Mutation capable" : "Read-only"}
                        </p>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1">
                        {template.pack.tools.slice(0, 3).map((tool) => (
                          <span
                            key={tool.id}
                            className="bg-muted text-muted-foreground rounded-md px-1.5 py-1 text-[11px]"
                          >
                            {tool.id}
                          </span>
                        ))}
                      </div>
                      <div className="mt-auto pt-5">
                        <Button
                          className="w-full"
                          disabled={busy || state.state === "current"}
                          onClick={() => void usePack(template)}
                        >
                          {busy ? (
                            <Loader2Icon className="animate-spin" />
                          ) : state.state === "current" ? (
                            <CheckIcon />
                          ) : (
                            <PlayIcon />
                          )}
                          {state.state === "current" ? "Current pack" : "Use pack"}
                        </Button>
                      </div>
                    </article>
                  );
                })}
              </div>
              {packTemplates.length === 0 ? (
                <EmptyPanelText>No installed packs were returned.</EmptyPanelText>
              ) : null}
              <WorkbenchAutomationsPanel
                open={open}
                pack={currentPack}
                canManage={canManageAutomations}
                onOpenHistory={(runId) => onOpenHistory(runId)}
              />
            </TabsContent>

            <TabsContent value="tools" className="overflow-y-auto p-5">
              <section className={`${sectionClass} mb-4`}>
                <div className="border-border border-b px-4 py-3">
                  <h2 className="text-sm font-semibold">Pending approvals</h2>
                </div>
                {pendingApprovals.length ? (
                  pendingApprovals.map((approval) => (
                    <div
                      key={approval.id}
                      className="border-border flex flex-col gap-3 border-b px-4 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{approval.toolId ?? "Tool request"}</p>
                        <p className="text-muted-foreground mt-0.5 text-xs">
                          {approval.reason ?? approval.input?.url ?? "Operator decision required."}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setApprovalDialog({ approval, action: "deny" })}
                        >
                          Deny
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => setApprovalDialog({ approval, action: "approve" })}
                        >
                          Approve
                        </Button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-4">
                    <EmptyPanelText>No pending approvals.</EmptyPanelText>
                  </div>
                )}
              </section>
              <section className={sectionClass}>
                <div className="border-border border-b px-4 py-3">
                  <h2 className="text-sm font-semibold">Registered tools</h2>
                </div>
                <div className="divide-border divide-y">
                  {(summary?.tools ?? []).map((tool) => (
                    <div
                      key={tool.name}
                      className="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium">{tool.name}</p>
                          <StatusPill
                            status={tool.permissionStatus ?? tool.status}
                            tone={tool.permissionStatus === "enabled" ? "completed" : undefined}
                          />
                          {tool.modelVisible ? (
                            <span className="text-muted-foreground text-xs">Model visible</span>
                          ) : null}
                        </div>
                        <p className="text-muted-foreground mt-1 text-xs">{tool.description}</p>
                      </div>
                      {tool.policyEditable ? (
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyTool === tool.name}
                            onClick={() =>
                              void updateToolPolicy(tool, {
                                status:
                                  tool.permissionStatus === "enabled" ? "disabled" : "enabled",
                              })
                            }
                          >
                            {tool.permissionStatus === "enabled" ? "Disable" : "Enable"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyTool === tool.name}
                            onClick={() =>
                              void updateToolPolicy(tool, { modelVisible: !tool.modelVisible })
                            }
                          >
                            {tool.modelVisible ? "Hide from model" : "Show to model"}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </section>
            </TabsContent>

            <TabsContent value="diagnostics" className="overflow-y-auto p-5">
              <div className="grid gap-4 lg:grid-cols-2">
                <section className={`${sectionClass} p-4`}>
                  <h2 className="flex items-center gap-2 text-sm font-semibold">
                    <WrenchIcon className="size-4" />
                    Conformance tools
                  </h2>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    {["diagnostic.ping", "runner.echo", "artifact.metadata.test"].map(
                      (toolName) => (
                        <Button
                          key={toolName}
                          variant="outline"
                          size="sm"
                          disabled={Boolean(busyTool)}
                          onClick={() =>
                            void runDiagnostic(
                              toolName,
                              toolName === "runner.echo"
                                ? { message: "runner echo ok" }
                                : toolName === "artifact.metadata.test"
                                  ? { label: "admin conformance" }
                                  : {},
                            )
                          }
                        >
                          {busyTool === toolName ? (
                            <Loader2Icon className="animate-spin" />
                          ) : (
                            <PlayIcon />
                          )}
                          {toolName}
                        </Button>
                      ),
                    )}
                  </div>
                  <form
                    className="mt-4 flex gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (urlTarget.trim())
                        void runDiagnostic("url.inspect", { url: urlTarget.trim() });
                    }}
                  >
                    <input
                      className={inputClass}
                      value={urlTarget}
                      onChange={(event) => setUrlTarget(event.target.value)}
                      placeholder="https://example.com"
                      aria-label="URL to inspect"
                    />
                    <Button
                      type="submit"
                      variant="outline"
                      disabled={!urlTarget.trim() || Boolean(busyTool)}
                    >
                      Inspect
                    </Button>
                  </form>
                </section>
                <section className={`${sectionClass} p-4`}>
                  <h2 className="flex items-center gap-2 text-sm font-semibold">
                    <FileClockIcon className="size-4" />
                    Recent runtime
                  </h2>
                  <div className="mt-3 space-y-3">
                    {(summary?.recentTraces ?? []).slice(0, 5).map((trace) => (
                      <div key={trace.traceId} className="border-border rounded-md border p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-medium">{trace.rootName}</p>
                          <StatusPill status={trace.status} tone={trace.status} />
                        </div>
                        <p className="text-muted-foreground mt-1 text-xs">
                          {trace.summary ?? `${trace.durationMs ?? 0}ms`}
                        </p>
                      </div>
                    ))}
                    {!summary?.recentTraces?.length ? (
                      <EmptyPanelText>No runtime traces.</EmptyPanelText>
                    ) : null}
                  </div>
                </section>
              </div>
              <section className={`${sectionClass} mt-4 p-4`}>
                <h2 className="text-sm font-semibold">Raw diagnostic context</h2>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <CopyId label="User id" value={summary?.identity.userId} />
                  <CopyId label="Workspace id" value={summary?.identity.workspaceId} />
                  <CopyId label="Agent id" value={summary?.identity.agentId} />
                </div>
                <details className="mt-4">
                  <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-xs">
                    Summary JSON
                  </summary>
                  <pre className="bg-muted mt-2 max-h-80 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
                    {JSON.stringify(summary ?? {}, null, 2)}
                  </pre>
                </details>
              </section>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      <Dialog open={customAgentOpen} onOpenChange={setCustomAgentOpen}>
        <DialogContent>
          <form onSubmit={createCustomAgent}>
            <DialogHeader>
              <DialogTitle>Create custom agent</DialogTitle>
              <DialogDescription>
                Create a separate snapshot from an installed behavior template.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-5 space-y-4">
              <label className="block text-sm font-medium">
                Name
                <input
                  className={`${inputClass} mt-1`}
                  value={customName}
                  onChange={(event) => setCustomName(event.target.value)}
                  maxLength={80}
                  required
                />
              </label>
              <label className="block text-sm font-medium">
                Description
                <input
                  className={`${inputClass} mt-1`}
                  value={customDescription}
                  onChange={(event) => setCustomDescription(event.target.value)}
                  maxLength={240}
                />
              </label>
              <label className="block text-sm font-medium">
                Behavior
                <select
                  className={`${inputClass} mt-1`}
                  value={customTemplateId}
                  onChange={(event) => setCustomTemplateId(event.target.value)}
                >
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={() => setCustomAgentOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!customName.trim() || busyTool === "custom-agent"}>
                {busyTool === "custom-agent" ? (
                  <Loader2Icon className="animate-spin" />
                ) : (
                  <BotIcon />
                )}
                Create agent
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(approvalDialog)}
        onOpenChange={(next) => {
          if (!next) {
            setApprovalDialog(null);
            setDenyReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {approvalDialog?.action === "approve" ? "Approve tool request" : "Deny tool request"}
            </DialogTitle>
            <DialogDescription>
              {approvalDialog?.approval.toolId ?? "Tool request"} ·{" "}
              {approvalDialog?.approval.reason ??
                approvalDialog?.approval.input?.url ??
                "No reason supplied."}
            </DialogDescription>
          </DialogHeader>
          {approvalDialog?.action === "deny" ? (
            <label className="text-sm font-medium">
              Reason
              <input
                className={`${inputClass} mt-1`}
                value={denyReason}
                onChange={(event) => setDenyReason(event.target.value)}
                placeholder="Why is this request denied?"
              />
            </label>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setApprovalDialog(null)}>
              Cancel
            </Button>
            <Button
              variant={approvalDialog?.action === "deny" ? "destructive" : "default"}
              disabled={Boolean(busyApprovalId)}
              onClick={() => void decideApproval()}
            >
              {busyApprovalId ? (
                <Loader2Icon className="animate-spin" />
              ) : approvalDialog?.action === "approve" ? (
                <CheckIcon />
              ) : (
                <ShieldCheckIcon />
              )}
              {approvalDialog?.action === "approve" ? "Approve" : "Deny"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
