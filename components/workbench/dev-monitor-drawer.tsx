"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ActivityIcon,
  AlertCircleIcon,
  BotIcon,
  Building2Icon,
  FileTextIcon,
  Loader2Icon,
  MessageSquareIcon,
  PanelRightOpenIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  UserIcon,
  UsersIcon,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type {
  CloudflareAdminSummaryResponse,
  CloudflareOwnedDemoRunResponse,
} from "@/lib/workbench/workbench-types";

const adminSummaryPath = "/api/workbench/admin-summary";
const cloudflareDemoRunsPath = "/api/workbench/cloudflare-demo-runs";
const workspacesPath = "/api/workbench/workspaces";

const readJsonResponse = async <T,>(response: Response, fallback: string): Promise<T> => {
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? fallback);
  return body;
};

const listValue = (items?: string[]) => (items && items.length > 0 ? items.join(", ") : undefined);

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
  const [activatingWorkspaceId, setActivatingWorkspaceId] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const demoSnapshot = summary?.demo.latestRun ?? null;
  const run = demoSnapshot?.run;
  const isDemoActive = run?.status ? !terminalStatuses.has(run.status) : false;
  const latestToolCall = demoSnapshot?.toolCalls.at(-1);
  const latestArtifact = demoSnapshot?.artifacts.at(-1);
  const latestDecision = demoSnapshot?.decisions.at(-1);
  const latestChatEvent = useMemo(
    () => summary?.events.find((event) => event.type?.startsWith("chat.")),
    [summary?.events],
  );
  const canManageWorkspaces =
    summary?.membership?.status === "active" &&
    ["owner", "admin"].includes(summary.membership.role.toLowerCase());

  const loadSummary = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(adminSummaryPath, { cache: "no-store" });
      const body = await readJsonResponse<CloudflareAdminSummaryResponse>(
        response,
        "Failed to load Cloudflare admin summary",
      );
      setSummary(body.summary ?? null);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load admin summary");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    void loadSummary();
  }, [open]);

  useEffect(() => {
    if (!open || !isDemoActive) return;
    const interval = window.setInterval(() => void loadSummary(), 750);
    return () => window.clearInterval(interval);
  }, [open, isDemoActive]);

  const startDemoRun = async () => {
    setIsStarting(true);
    setError(null);
    try {
      const response = await fetch(cloudflareDemoRunsPath, { method: "POST" });
      await readJsonResponse<CloudflareOwnedDemoRunResponse>(
        response,
        "Failed to start Cloudflare demo run",
      );
      await loadSummary();
    } catch (startError) {
      setError(
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
    setError(null);
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
      setError(createError instanceof Error ? createError.message : "Failed to create workspace");
    } finally {
      setIsCreatingWorkspace(false);
    }
  };

  const activateWorkspace = async (workspaceId: string) => {
    setActivatingWorkspaceId(workspaceId);
    setError(null);
    try {
      const response = await fetch(
        `${workspacesPath}/${encodeURIComponent(workspaceId)}/activate`,
        { method: "POST" },
      );
      await readJsonResponse(response, "Failed to activate workspace");
      await loadSummary();
    } catch (activateError) {
      setError(
        activateError instanceof Error ? activateError.message : "Failed to activate workspace",
      );
    } finally {
      setActivatingWorkspaceId(null);
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
            Cloudflare-owned account, workspace, agent, chat, and demo.inspect state.
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

          <MonitorSection icon={UserIcon} title="Identity">
            <StatusRow
              label="Auth"
              value={summary?.identity.authMode ?? (isLoading ? "loading" : "unknown")}
            />
            <StatusRow
              label="Account source"
              value={summary?.account?.source ?? summary?.identity.workspaceSource ?? "unknown"}
            />
            <StatusRow label="User" value={summary?.user?.email ?? summary?.user?.displayName} />
            <StatusRow label="User status" value={summary?.user?.status} />
            <CopyId label="User id" value={summary?.identity.userId} />
            <CopyId label="Account id" value={summary?.account?.id} />
          </MonitorSection>

          <MonitorSection icon={Building2Icon} title="Workspace">
            <StatusRow label="Name" value={summary?.workspace?.name} />
            <StatusRow label="Status" value={summary?.workspace?.status} />
            <StatusRow
              label="Default"
              value={summary?.workspace ? String(summary.workspace.isDefault) : undefined}
            />
            <StatusRow
              label="Active"
              value={summary?.workspace ? String(summary.workspace.isActive) : undefined}
            />
            <CopyId label="Workspace id" value={summary?.identity.workspaceId} />
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
                          disabled={activatingWorkspaceId === workspace.id || !canManageWorkspaces}
                        >
                          {activatingWorkspaceId === workspace.id ? (
                            <Loader2Icon className="animate-spin" />
                          ) : null}
                          Make active
                        </Button>
                      )}
                    </div>
                    <CopyId label="Workspace id" value={workspace.id} />
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyPanelText>No account workspaces loaded.</EmptyPanelText>
            )}
          </MonitorSection>

          <MonitorSection icon={UsersIcon} title="Membership">
            <StatusRow label="Source" value={summary?.membership?.source} />
            <StatusRow
              label="Role / status"
              value={
                summary?.membership
                  ? `${summary.membership.role} / ${summary.membership.status}`
                  : undefined
              }
            />
            <StatusRow label="Roles" value={listValue(summary?.membership?.roles)} />
            <StatusRow label="Permissions" value={listValue(summary?.membership?.permissions)} />
            <StatusRow
              label="Workspace admin"
              value={summary?.membership ? String(canManageWorkspaces) : undefined}
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
          </MonitorSection>

          <MonitorSection icon={BotIcon} title="Agents">
            <StatusRow label="Default agent" value={summary?.defaultAgent?.name} />
            <CopyId label="Active agent id" value={summary?.identity.agentId} />
            {summary?.agents.length ? (
              <ol className="space-y-2">
                {summary.agents.map((agent) => (
                  <li key={agent.id} className="border-border rounded-md border p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{agent.name}</span>
                      <StatusPill
                        status={agent.isDefault ? `default / ${agent.status}` : agent.status}
                        tone={agent.status}
                      />
                    </div>
                    {agent.description ? (
                      <p className="text-muted-foreground mt-1 text-xs">{agent.description}</p>
                    ) : null}
                    <CopyId label="Agent id" value={agent.id} />
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyPanelText>No workspace agents loaded.</EmptyPanelText>
            )}
          </MonitorSection>

          <MonitorSection icon={MessageSquareIcon} title="Chat Path">
            <StatusRow label="Latest session" value={summary?.chat.latestSession?.status} />
            <StatusRow label="Latest thread" value={summary?.chat.latestThread?.status} />
            <StatusRow label="Latest run" value={summary?.chat.latestRun?.status} />
            <StatusRow
              label="Latest policy"
              value={
                summary?.chat.latestPolicyDecision
                  ? `${summary.chat.latestPolicyDecision.decision}: ${summary.chat.latestPolicyDecision.reason}`
                  : undefined
              }
            />
            <StatusRow
              label="Latest chat event"
              value={latestChatEvent?.type ?? "no chat event loaded"}
              tone={latestChatEvent ? "ok" : "muted"}
            />
            <CopyId label="Session id" value={summary?.chat.latestSession?.sessionId} />
            <CopyId label="Thread id" value={summary?.chat.latestThread?.threadId} />
            <CopyId label="Chat run id" value={summary?.chat.latestRun?.id} />
          </MonitorSection>

          <MonitorSection icon={WrenchIcon} title="Demo Inspect Path">
            <div className="flex items-center justify-between gap-3">
              <StatusPill status={`demo run: ${run?.status ?? "idle"}`} tone={run?.status} />
              <Button size="sm" onClick={startDemoRun} disabled={isStarting || isDemoActive}>
                {isStarting ? <Loader2Icon className="animate-spin" /> : <PlayIcon />}
                Run diagnostic
              </Button>
            </div>
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
            <CopyId label="Run id" value={run?.id} />
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
          </MonitorSection>

          <MonitorSection icon={ActivityIcon} title="Cloudflare Events">
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
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyPanelText>Open chat or run the diagnostic to populate events.</EmptyPanelText>
            )}
          </MonitorSection>

          <MonitorSection icon={AlertCircleIcon} title="Last Error">
            {error ? <p className="text-destructive text-sm">{error}</p> : null}
            {summary?.lastError ? (
              <div className="border-destructive/30 bg-destructive/10 rounded-md border p-3 text-sm">
                <p className="text-destructive font-medium">{summary.lastError.message}</p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {summary.lastError.source}
                  {summary.lastError.status ? ` / ${summary.lastError.status}` : ""}
                  {summary.lastError.createdAt
                    ? ` / ${formatTime(summary.lastError.createdAt)}`
                    : ""}
                </p>
                <CopyId label="Error target id" value={summary.lastError.targetId} />
              </div>
            ) : !error ? (
              <EmptyPanelText>No Cloudflare-owned error found for this scope.</EmptyPanelText>
            ) : null}
          </MonitorSection>
        </div>
      </DialogContent>
    </Dialog>
  );
}
