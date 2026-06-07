"use client";

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  ActivityIcon,
  AlertCircleIcon,
  Building2Icon,
  ChevronDownIcon,
  FileTextIcon,
  Loader2Icon,
  MessageSquareIcon,
  PanelRightOpenIcon,
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
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { chatRuntimeStateLabel, chatRuntimeStateTone } from "@/lib/workbench/chat-runtime-display";
import type {
  CloudflareAdminSummaryResponse,
  CloudflareOwnedDemoRunResponse,
} from "@/lib/workbench/workbench-types";

const adminSummaryPath = "/api/workbench/admin-summary";
const cloudflareDemoRunsPath = "/api/workbench/cloudflare-demo-runs";
const workspacesPath = "/api/workbench/workspaces";
const agentsPath = "/api/workbench/agents";
const agentModelOptions = ["deepseek/deepseek-v4-flash", "openai/gpt-4.1-mini"] as const;

const readJsonResponse = async <T,>(response: Response, fallback: string): Promise<T> => {
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? fallback);
  return body;
};

const listValue = (items?: string[]) => (items && items.length > 0 ? items.join(", ") : undefined);

function DetailsBlock({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="border-border rounded-md border">
      <CollapsibleTrigger className="hover:bg-muted/60 flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium">
        {title}
        <ChevronDownIcon className="text-muted-foreground size-4" />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 border-t px-3 py-3">{children}</CollapsibleContent>
    </Collapsible>
  );
}

export function DevMonitorDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [summary, setSummary] = useState<CloudflareAdminSummaryResponse["summary"] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
  const [isCreatingAgent, setIsCreatingAgent] = useState(false);
  const [activatingWorkspaceId, setActivatingWorkspaceId] = useState<string | null>(null);
  const [activatingAgentId, setActivatingAgentId] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState("");
  const [agentName, setAgentName] = useState("");
  const [agentDescription, setAgentDescription] = useState("");
  const [agentProfile, setAgentProfile] = useState<"default" | "analyst" | "operator">("analyst");
  const [agentModel, setAgentModel] = useState<(typeof agentModelOptions)[number]>(
    "deepseek/deepseek-v4-flash",
  );
  const [fetchError, setFetchError] = useState<string | null>(null);

  const demoSnapshot = summary?.demo.latestRun ?? null;
  const chatRuntime = summary?.chatRuntime ?? null;
  const run = demoSnapshot?.run;
  const isDemoActive = run?.status ? !terminalStatuses.has(run.status) : false;
  const isChatActive = chatRuntime?.state === "running";
  const latestToolCall = demoSnapshot?.toolCalls.at(-1);
  const latestArtifact = demoSnapshot?.artifacts.at(-1);
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
    ? { message: fetchError, source: "drawer", status: undefined, targetId: undefined }
    : chatRuntime?.failure
      ? {
          message: chatRuntime.failure.message,
          source: chatRuntime.failure.source,
          status: chatRuntime.failure.status,
          targetId: chatRuntime.failure.targetId,
        }
      : summary?.lastError
        ? {
            message: summary.lastError.message,
            source: summary.lastError.source,
            status: summary.lastError.status,
            targetId: summary.lastError.targetId,
          }
        : null;
  const chatLabel =
    fetchError && !chatRuntime ? "Unavailable" : chatRuntimeStateLabel(chatRuntime?.state);
  const chatTone = fetchError && !chatRuntime ? "failed" : chatRuntimeStateTone(chatRuntime?.state);

  const loadSummary = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(adminSummaryPath, { cache: "no-store" });
      const body = await readJsonResponse<CloudflareAdminSummaryResponse>(
        response,
        "Failed to load Cloudflare admin summary",
      );
      setSummary(body.summary ?? null);
      setFetchError(null);
    } catch (loadError) {
      setFetchError(
        loadError instanceof Error ? loadError.message : "Failed to load admin summary",
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    void loadSummary();
  }, [open]);

  useEffect(() => {
    if (!open || (!isDemoActive && !isChatActive)) return;
    const interval = window.setInterval(() => void loadSummary(), 750);
    return () => window.clearInterval(interval);
  }, [open, isDemoActive, isChatActive]);

  const startDemoRun = async () => {
    setIsStarting(true);
    setFetchError(null);
    try {
      const response = await fetch(cloudflareDemoRunsPath, { method: "POST" });
      await readJsonResponse<CloudflareOwnedDemoRunResponse>(
        response,
        "Failed to start Cloudflare demo run",
      );
      await loadSummary();
    } catch (startError) {
      setFetchError(
        startError instanceof Error ? startError.message : "Failed to start Cloudflare demo run",
      );
    } finally {
      setIsStarting(false);
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
      await loadSummary();
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
      await loadSummary();
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
          activate: true,
        }),
      });
      await readJsonResponse(response, "Failed to create agent");
      setAgentName("");
      setAgentDescription("");
      setAgentProfile("analyst");
      setAgentModel("deepseek/deepseek-v4-flash");
      await loadSummary();
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
      await loadSummary();
    } catch (activateError) {
      setFetchError(
        activateError instanceof Error ? activateError.message : "Failed to activate agent",
      );
    } finally {
      setActivatingAgentId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="bg-background/95 shadow-xs">
          <PanelRightOpenIcon className="size-4" />
          Dev Monitor
        </Button>
      </DialogTrigger>
      <DialogContent
        className="top-0 right-0 left-auto h-dvh max-h-dvh w-[min(100vw,30rem)] max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none border-y-0 border-r-0 p-0 sm:max-w-none"
        aria-describedby="dev-monitor-description"
      >
        <DialogHeader className="border-border border-b px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-base">
            <PanelRightOpenIcon className="text-muted-foreground size-4" />
            Dev Monitor
          </DialogTitle>
          <DialogDescription id="dev-monitor-description">
            Flow-first view of Cloudflare-owned chat, workspace, agent, and diagnostic state.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-muted-foreground text-xs">
              Summary generated {formatTime(summary?.generatedAt)}
            </p>
            <Button size="sm" variant="outline" onClick={loadSummary} disabled={isLoading}>
              {isLoading ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
              Refresh
            </Button>
          </div>

          <MonitorSection icon={ActivityIcon} title="Flow Overview">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={chatLabel} tone={chatTone} />
              {importantError ? <StatusPill status="Needs attention" tone="failed" /> : null}
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <StatusRow label="Workspace" value={summary?.workspace?.name} compact tone="ok" />
              <StatusRow
                label="Agent"
                value={
                  summary?.activeAgent
                    ? `${summary.activeAgent.name} / ${summary.activeAgent.profile}`
                    : undefined
                }
                compact
                tone="ok"
              />
              <StatusRow
                label="Model"
                value={summary?.activeAgent?.runtime.model}
                compact
                tone="ok"
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
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <StatusRow
                label="Chat"
                value={chatLabel}
                compact
                tone={
                  chatRuntime?.state === "thread_ready" || chatRuntime?.state === "completed"
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
                label="Thread"
                value={chatRuntime?.latestThread?.status ?? "No thread yet"}
                compact
              />
              <StatusRow
                label="Runtime"
                value={
                  summary?.activeAgent?.runtime
                    ? `${summary.activeAgent.runtime.provider} / ${summary.activeAgent.runtime.model}`
                    : undefined
                }
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
              <StatusRow label="User" value={summary?.user?.email ?? summary?.user?.displayName} />
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

          <MonitorSection icon={Building2Icon} title="Manage Workspace & Agents">
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
                  disabled={isCreatingWorkspace || !workspaceName.trim() || !canManageWorkspaces}
                >
                  {isCreatingWorkspace ? <Loader2Icon className="animate-spin" /> : <PlusIcon />}
                  Create
                </Button>
              </form>
              {summary?.workspaces?.length ? (
                <ol className="space-y-2">
                  {summary.workspaces.map((workspace) => (
                    <li key={workspace.id} className="border-border rounded-md border p-3 text-sm">
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
                <StatusRow label="Behavior source" value={summary?.activeAgent?.behavior.source} />
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
                    onChange={(event) =>
                      setAgentProfile(event.target.value as "default" | "analyst" | "operator")
                    }
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
                <textarea
                  className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring min-h-16 w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
                  value={agentDescription}
                  onChange={(event) => setAgentDescription(event.target.value)}
                  placeholder="Optional description"
                  maxLength={240}
                />
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
                        <p className="text-muted-foreground mt-1 text-xs">{agent.description}</p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              ) : (
                <EmptyPanelText>No workspace agents loaded.</EmptyPanelText>
              )}
            </DetailsBlock>
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
            </DetailsBlock>
          </MonitorSection>

          <MonitorSection icon={AlertCircleIcon} title="Advanced Details">
            <DetailsBlock title="Raw scope ids">
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

            <DetailsBlock title="Agent behavior config">
              <StatusRow label="Profile" value={summary?.activeAgent?.behavior.profile} />
              <StatusRow label="Source" value={summary?.activeAgent?.behavior.source} />
              <StatusRow label="Version" value={summary?.activeAgent?.behavior.version} />
              <CopyId label="Instruction id" value={summary?.activeAgent?.behavior.instructionId} />
            </DetailsBlock>

            <DetailsBlock title="Membership and external identity">
              <StatusRow label="Auth mode" value={summary?.identity.authMode} />
              <StatusRow label="Account source" value={summary?.account?.source} />
              <StatusRow label="Membership source" value={summary?.membership?.source} />
              <StatusRow label="Roles" value={listValue(summary?.membership?.roles)} />
              <StatusRow label="Permissions" value={listValue(summary?.membership?.permissions)} />
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
                <EmptyPanelText>Open chat or run the diagnostic to populate events.</EmptyPanelText>
              )}
            </DetailsBlock>

            <DetailsBlock title="Error internals" defaultOpen={Boolean(importantError)}>
              {importantError ? (
                <div className="border-destructive/30 bg-destructive/10 rounded-md border p-3 text-sm">
                  <p className="text-destructive font-medium">{importantError.message}</p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {importantError.source}
                    {importantError.status ? ` / ${importantError.status}` : ""}
                  </p>
                  <CopyId label="Error target id" value={importantError.targetId} />
                </div>
              ) : (
                <EmptyPanelText>No Cloudflare-owned error found for this scope.</EmptyPanelText>
              )}
            </DetailsBlock>
          </MonitorSection>
        </div>
      </DialogContent>
    </Dialog>
  );
}
