"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@workos-inc/authkit-nextjs/components";
import {
  Building2Icon,
  CheckCircle2Icon,
  Loader2Icon,
  PlusIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  DownloadIcon,
  Trash2Icon,
  UsersIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  CloudflareWorkspaceMembersResponse,
  CloudflareWorkspacesResponse,
  WorkbenchAccountContextResponse,
  WorkspaceMemberSummary,
  WorkspaceSummary,
  CloudflareRetentionPolicyResponse,
  CloudflareDataJobResponse,
} from "@/lib/workbench/workbench-types";
import { readJsonResponse } from "@/lib/workbench/read-json-response";

const accountsPath = "/api/workbench/accounts";
const workspacesPath = "/api/workbench/workspaces";
const retentionFields = [
  ["chatMessageRetentionDays", "Chat messages", 1, 3650],
  ["runPayloadRetentionDays", "Run and tool payloads", 1, 3650],
  ["artifactRetentionDays", "Artifacts", 1, 3650],
  ["operationalEventRetentionDays", "Operational events", 1, 3650],
  ["runtimeTraceRetentionDays", "Runtime traces", 1, 3650],
  ["auditActionRetentionDays", "Audit and action ledger", 365, 3650],
] as const;

export function WorkbenchWorkspacePanel({
  open,
  onOpenChange,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const { switchToOrganization } = useAuth();
  const [accounts, setAccounts] = useState<WorkbenchAccountContextResponse["accounts"]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [members, setMembers] = useState<WorkspaceMemberSummary[]>([]);
  const [availableMembers, setAvailableMembers] = useState<WorkspaceMemberSummary[]>([]);
  const [currentMembership, setCurrentMembership] = useState<WorkspaceMemberSummary | null>(null);
  const [workspaceName, setWorkspaceName] = useState("");
  const [memberToAdd, setMemberToAdd] = useState("");
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retention, setRetention] = useState<CloudflareRetentionPolicyResponse["policy"] | null>(
    null,
  );
  const [dataJob, setDataJob] = useState<CloudflareDataJobResponse["job"] | null>(null);
  const [deletionConfirmation, setDeletionConfirmation] = useState("");

  const canManageWorkspace =
    currentMembership?.status === "active" &&
    (currentMembership.role === "owner" || currentMembership.role === "admin");

  const loadPanel = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [accountBody, workspaceBody] = await Promise.all([
        fetch(accountsPath, { cache: "no-store" }).then((response) =>
          readJsonResponse<WorkbenchAccountContextResponse>(response, "Failed to load accounts"),
        ),
        fetch(workspacesPath, { cache: "no-store" }).then((response) =>
          readJsonResponse<CloudflareWorkspacesResponse>(response, "Failed to load workspaces"),
        ),
      ]);
      const nextActiveWorkspaceId = workspaceBody.activeWorkspaceId ?? null;
      setAccounts(accountBody.accounts ?? []);
      setWorkspaces(workspaceBody.workspaces ?? []);
      setActiveWorkspaceId(nextActiveWorkspaceId);

      if (!nextActiveWorkspaceId) {
        setMembers([]);
        setAvailableMembers([]);
        setCurrentMembership(null);
        return;
      }

      const response = await fetch(
        `${workspacesPath}/${encodeURIComponent(nextActiveWorkspaceId)}/members`,
        { cache: "no-store" },
      );
      if (response.status === 403) {
        setMembers([]);
        setAvailableMembers([]);
        setCurrentMembership(null);
        return;
      }
      const memberBody = await readJsonResponse<CloudflareWorkspaceMembersResponse>(
        response,
        "Failed to load workspace members",
      );
      setMembers(memberBody.members ?? []);
      setAvailableMembers(memberBody.availableMembers ?? []);
      setCurrentMembership(memberBody.currentMembership ?? null);
      const retentionResponse = await fetch("/api/workbench/retention-policy", {
        cache: "no-store",
      });
      if (retentionResponse.ok) {
        const retentionBody = (await retentionResponse.json()) as CloudflareRetentionPolicyResponse;
        setRetention(retentionBody.policy);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load workspace access");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void loadPanel();
  }, [loadPanel, open]);

  useEffect(() => {
    if (!open || !dataJob || !["queued", "running"].includes(dataJob.status)) return;
    const timeout = window.setTimeout(() => {
      void fetch(`/api/workbench/data-exports/${encodeURIComponent(dataJob.id)}`, {
        cache: "no-store",
      })
        .then((response) =>
          readJsonResponse<CloudflareDataJobResponse>(response, "Failed to refresh export"),
        )
        .then((body) => setDataJob(body.job))
        .catch((pollError) =>
          setError(pollError instanceof Error ? pollError.message : "Failed to refresh export"),
        );
    }, 1_000);
    return () => window.clearTimeout(timeout);
  }, [dataJob, open]);

  const sortedWorkspaces = useMemo(
    () =>
      [...workspaces].sort((left, right) => {
        if (left.isActive !== right.isActive) return left.isActive ? -1 : 1;
        if (left.isDefault !== right.isDefault) return left.isDefault ? -1 : 1;
        return left.name.localeCompare(right.name);
      }),
    [workspaces],
  );

  const switchAccount = async (organizationId: string) => {
    setBusyId(`account:${organizationId}`);
    setError(null);
    try {
      const result = await switchToOrganization(organizationId);
      if ("error" in result) throw new Error(result.error);
      window.location.reload();
    } catch (switchError) {
      setError(switchError instanceof Error ? switchError.message : "Failed to switch account");
      setBusyId(null);
    }
  };

  const switchWorkspace = async (workspaceId: string) => {
    setBusyId(`workspace:${workspaceId}`);
    setError(null);
    try {
      await fetch(`${workspacesPath}/${encodeURIComponent(workspaceId)}/activate`, {
        method: "POST",
      }).then((response) => readJsonResponse(response, "Failed to switch workspace"));
      window.location.reload();
    } catch (switchError) {
      setError(switchError instanceof Error ? switchError.message : "Failed to switch workspace");
      setBusyId(null);
    }
  };

  const createWorkspace = async () => {
    const name = workspaceName.trim();
    if (!name) return;
    setBusyId("workspace:create");
    setError(null);
    try {
      await fetch(workspacesPath, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      }).then((response) => readJsonResponse(response, "Failed to create workspace"));
      window.location.reload();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create workspace");
      setBusyId(null);
    }
  };

  const updateMember = async (
    member: WorkspaceMemberSummary,
    input: { role?: "owner" | "admin" | "member"; status?: "active" | "disabled" },
  ) => {
    if (!activeWorkspaceId) return;
    setBusyId(`member:${member.userId}`);
    setError(null);
    try {
      await fetch(
        `${workspacesPath}/${encodeURIComponent(activeWorkspaceId)}/members/${encodeURIComponent(member.userId)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            role: input.role ?? member.role,
            status: input.status ?? member.status,
          }),
        },
      ).then((response) => readJsonResponse(response, "Failed to update member access"));
      await loadPanel();
    } catch (updateError) {
      setError(
        updateError instanceof Error ? updateError.message : "Failed to update member access",
      );
    } finally {
      setBusyId(null);
    }
  };

  const addMember = async () => {
    if (!activeWorkspaceId || !memberToAdd) return;
    setBusyId(`member:add:${memberToAdd}`);
    setError(null);
    try {
      await fetch(`${workspacesPath}/${encodeURIComponent(activeWorkspaceId)}/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: memberToAdd, role: "member" }),
      }).then((response) => readJsonResponse(response, "Failed to add workspace member"));
      setMemberToAdd("");
      await loadPanel();
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : "Failed to add workspace member");
    } finally {
      setBusyId(null);
    }
  };

  const confirmRetention = async () => {
    if (!retention) return;
    setBusyId("retention:confirm");
    setError(null);
    try {
      const response = await fetch("/api/workbench/retention-policy", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          artifactRetentionDays: retention.artifactRetentionDays,
          operationalEventRetentionDays: retention.operationalEventRetentionDays,
          runtimeTraceRetentionDays: retention.runtimeTraceRetentionDays,
          chatMessageRetentionDays: retention.chatMessageRetentionDays,
          runPayloadRetentionDays: retention.runPayloadRetentionDays,
          auditActionRetentionDays: retention.auditActionRetentionDays,
          confirm: true,
        }),
      });
      const body = await readJsonResponse<CloudflareRetentionPolicyResponse>(
        response,
        "Failed to confirm retention",
      );
      setRetention(body.policy);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Failed to confirm retention");
    } finally {
      setBusyId(null);
    }
  };

  const createDataExport = async () => {
    setBusyId("export:create");
    setError(null);
    try {
      const response = await fetch("/api/workbench/data-exports", { method: "POST" });
      const body = await readJsonResponse<CloudflareDataJobResponse>(
        response,
        "Failed to create export",
      );
      setDataJob(body.job);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Failed to create export");
    } finally {
      setBusyId(null);
    }
  };

  const requestDeletion = async () => {
    const workspace = workspaces.find((candidate) => candidate.id === activeWorkspaceId);
    if (!workspace || deletionConfirmation !== workspace.name) return;
    setBusyId("workspace:delete");
    setError(null);
    try {
      await fetch("/api/workbench/workspace-deletion", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceName: deletionConfirmation }),
      }).then((response) =>
        readJsonResponse(
          response,
          "Workspace deletion requires a WorkOS sign-in from the last five minutes",
        ),
      );
      window.location.reload();
    } catch (deletionError) {
      setError(
        deletionError instanceof Error ? deletionError.message : "Failed to quarantine workspace",
      );
      setBusyId(null);
    }
  };

  const closeFromOverlay = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="grid h-[min(82vh,44rem)] w-[min(94vw,42rem)] max-w-[calc(100vw-1.5rem)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-[min(94vw,42rem)]"
        onCloseAutoFocus={onCloseAutoFocus}
        onOverlayMouseDown={closeFromOverlay}
        onOverlayPointerDown={closeFromOverlay}
        onOverlayTouchStart={closeFromOverlay}
      >
        <DialogHeader className="border-border border-b px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Building2Icon className="text-muted-foreground size-4" />
            Workspace
          </DialogTitle>
          <DialogDescription>Account, workspace, and member access.</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 overflow-auto">
          {error ? (
            <div className="border-destructive/40 bg-destructive/10 text-destructive m-4 rounded-md border px-3 py-2 text-sm">
              {error}
            </div>
          ) : null}

          <section className="border-border border-b p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-sm font-medium">
                <ShieldCheckIcon className="text-muted-foreground size-4" />
                Account
              </h2>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => void loadPanel()}
                disabled={loading}
              >
                {loading ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
                <span className="sr-only">Refresh workspace access</span>
              </Button>
            </div>
            <div className="space-y-2">
              {(accounts ?? []).map((account) => (
                <div key={account.id} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{account.name}</span>
                    <span className="text-muted-foreground block text-xs">
                      {account.role ?? account.source}
                    </span>
                  </span>
                  {account.isCurrent ? (
                    <span className="text-muted-foreground flex items-center gap-1 text-xs">
                      <CheckCircle2Icon className="size-3.5" /> Current
                    </span>
                  ) : account.organizationId ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={Boolean(busyId)}
                      onClick={() => void switchAccount(account.organizationId!)}
                    >
                      {busyId === `account:${account.organizationId}` ? (
                        <Loader2Icon className="animate-spin" />
                      ) : null}
                      Switch
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          </section>

          <section className="border-border border-b p-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-medium">
              <Building2Icon className="text-muted-foreground size-4" />
              Workspaces
            </h2>
            <div className="space-y-2">
              {sortedWorkspaces.map((workspace) => (
                <div key={workspace.id} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{workspace.name}</span>
                    <span className="text-muted-foreground block text-xs">
                      {workspace.isDefault ? "Default" : "Workspace"} / {workspace.status}
                    </span>
                  </span>
                  {workspace.isActive ? (
                    <span className="text-muted-foreground flex items-center gap-1 text-xs">
                      <CheckCircle2Icon className="size-3.5" /> Active
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={Boolean(busyId) || workspace.status !== "active"}
                      onClick={() => void switchWorkspace(workspace.id)}
                    >
                      {busyId === `workspace:${workspace.id}` ? (
                        <Loader2Icon className="animate-spin" />
                      ) : null}
                      Switch
                    </Button>
                  )}
                </div>
              ))}
            </div>
            {canManageWorkspace ? (
              <form
                className="mt-4 flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void createWorkspace();
                }}
              >
                <input
                  value={workspaceName}
                  onChange={(event) => setWorkspaceName(event.target.value)}
                  maxLength={80}
                  placeholder="Workspace name"
                  className="border-input bg-background h-9 min-w-0 flex-1 rounded-md border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <Button type="submit" size="sm" disabled={!workspaceName.trim() || Boolean(busyId)}>
                  {busyId === "workspace:create" ? (
                    <Loader2Icon className="animate-spin" />
                  ) : (
                    <PlusIcon />
                  )}
                  Create
                </Button>
              </form>
            ) : null}
          </section>

          {canManageWorkspace && retention ? (
            <section className="border-border border-b p-4">
              <h2 className="mb-2 flex items-center gap-2 text-sm font-medium">
                <ShieldCheckIcon className="text-muted-foreground size-4" />
                Data lifecycle
              </h2>
              <p className="text-muted-foreground text-xs">
                Chat, run payloads, and artifacts: {retention.chatMessageRetentionDays}–
                {retention.artifactRetentionDays} days. Audit and action history:{" "}
                {retention.auditActionRetentionDays} days.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {retentionFields.map(([key, label, min, max]) => (
                  <label key={key} className="text-muted-foreground grid gap-1 text-xs">
                    <span>{label}</span>
                    <input
                      type="number"
                      min={min}
                      max={max}
                      value={retention[key]}
                      onChange={(event) =>
                        setRetention((current) =>
                          current
                            ? {
                                ...current,
                                [key]: Math.max(
                                  min,
                                  Math.min(max, Number(event.target.value) || min),
                                ),
                              }
                            : current,
                        )
                      }
                      className="border-input bg-background h-8 rounded-md border px-2 text-sm text-foreground"
                    />
                  </label>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={Boolean(busyId)}
                  onClick={() => void confirmRetention()}
                >
                  {retention.confirmed ? <CheckCircle2Icon /> : <ShieldCheckIcon />}
                  {retention.confirmed ? "Save confirmed policy" : "Confirm privacy defaults"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={Boolean(busyId)}
                  onClick={() => void createDataExport()}
                >
                  <DownloadIcon /> Create export
                </Button>
                {dataJob ? (
                  dataJob.status === "completed" ? (
                    <Button size="sm" asChild>
                      <a
                        href={`/api/workbench/data-exports/${encodeURIComponent(dataJob.id)}/download`}
                      >
                        Download ZIP
                      </a>
                    </Button>
                  ) : (
                    <span className="text-muted-foreground self-center text-xs">
                      Export {dataJob.status}
                    </span>
                  )
                ) : null}
              </div>
            </section>
          ) : null}

          {currentMembership?.role === "owner" ? (
            <section className="border-destructive/30 border-b p-4">
              <h2 className="mb-2 flex items-center gap-2 text-sm font-medium">
                <Trash2Icon className="text-destructive size-4" /> Delete workspace
              </h2>
              <p className="text-muted-foreground mb-3 text-xs">
                Credentials are revoked immediately. Retained content can be recovered for 30 days
                before permanent purge.
              </p>
              <div className="flex gap-2">
                <input
                  className="border-input bg-background h-9 min-w-0 flex-1 rounded-md border px-3 text-sm"
                  value={deletionConfirmation}
                  onChange={(event) => setDeletionConfirmation(event.target.value)}
                  placeholder={`Type ${workspaces.find((workspace) => workspace.id === activeWorkspaceId)?.name ?? "workspace name"}`}
                />
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={
                    deletionConfirmation !==
                      workspaces.find((workspace) => workspace.id === activeWorkspaceId)?.name ||
                    Boolean(busyId)
                  }
                  onClick={() => void requestDeletion()}
                >
                  Quarantine
                </Button>
              </div>
            </section>
          ) : null}

          {canManageWorkspace ? (
            <section className="p-4">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-medium">
                <UsersIcon className="text-muted-foreground size-4" />
                Members
              </h2>
              <div className="divide-border divide-y">
                {members.map((member) => {
                  const isBusy = busyId === `member:${member.userId}`;
                  const canEdit = !member.isCurrentUser;
                  return (
                    <div
                      key={member.id}
                      className="grid gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_8rem_7rem] sm:items-center"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {member.displayName}
                          {member.isCurrentUser ? " (you)" : ""}
                        </span>
                        <span className="text-muted-foreground block truncate text-xs">
                          {member.email ?? member.userId}
                        </span>
                      </span>
                      <select
                        value={member.role}
                        disabled={!canEdit || isBusy}
                        aria-label={`Role for ${member.displayName}`}
                        onChange={(event) =>
                          void updateMember(member, {
                            role: event.target.value as "owner" | "admin" | "member",
                          })
                        }
                        className="border-input bg-background h-8 rounded-md border px-2 text-xs"
                      >
                        <option value="owner">Owner</option>
                        <option value="admin">Admin</option>
                        <option value="member">Member</option>
                      </select>
                      <Button
                        size="sm"
                        variant={member.status === "active" ? "outline" : "secondary"}
                        disabled={!canEdit || isBusy}
                        onClick={() =>
                          void updateMember(member, {
                            status: member.status === "active" ? "disabled" : "active",
                          })
                        }
                      >
                        {isBusy ? <Loader2Icon className="animate-spin" /> : null}
                        {member.status === "active" ? "Disable" : "Enable"}
                      </Button>
                    </div>
                  );
                })}
              </div>
              {availableMembers.length ? (
                <form
                  className="border-border mt-4 flex gap-2 border-t pt-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void addMember();
                  }}
                >
                  <select
                    value={memberToAdd}
                    onChange={(event) => setMemberToAdd(event.target.value)}
                    aria-label="Account member to add"
                    className="border-input bg-background h-9 min-w-0 flex-1 rounded-md border px-2 text-sm"
                  >
                    <option value="">Add account member</option>
                    {availableMembers.map((member) => (
                      <option key={member.id} value={member.userId}>
                        {member.displayName}
                      </option>
                    ))}
                  </select>
                  <Button type="submit" size="sm" disabled={!memberToAdd || Boolean(busyId)}>
                    {busyId === `member:add:${memberToAdd}` ? (
                      <Loader2Icon className="animate-spin" />
                    ) : (
                      <PlusIcon />
                    )}
                    Add
                  </Button>
                </form>
              ) : null}
            </section>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
