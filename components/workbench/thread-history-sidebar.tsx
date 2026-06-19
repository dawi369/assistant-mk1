"use client";

import { useEffect, useState } from "react";
import { useAuiState } from "@assistant-ui/react";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  Loader2Icon,
  MessageSquareIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { useWorkbenchComposerFocus } from "@/components/workbench/composer-focus-context";
import { cn } from "@/lib/utils";
import { useWorkbenchAgentConnection } from "@/lib/workbench/use-agent-connection";
import type { ChatThreadSummary } from "@/lib/workbench/workbench-types";

export function AssistantThreadHistorySidebar() {
  const isRunning = useAuiState((state) => state.thread.isRunning);
  return <ThreadHistorySidebar disableNewChat={isRunning} />;
}

export function ThreadHistorySidebar({
  disableNewChat = false,
  disableThreadActions = false,
}: {
  disableNewChat?: boolean;
  disableThreadActions?: boolean;
}) {
  const {
    session,
    threads,
    archivedThreads,
    pending,
    error,
    isInitialLoading,
    isLoadingArchivedThreads,
    archivedThreadsError,
    deletingThreadIds,
    startNewSession,
    activateThread,
    renameThread,
    archiveThread,
    restoreThread,
    deleteThread,
    loadArchivedThreads,
  } = useWorkbenchAgentConnection();
  const [view, setView] = useState<"active" | "archived">("active");
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const { focusComposer } = useWorkbenchComposerFocus();
  const creatingThread = pending?.type === "create";
  const isNavigatingThread =
    pending?.type === "activate" || pending?.type === "create" || pending?.type === "materialize";
  const isCached = session?.isStale === true;
  const actionsDisabled = disableThreadActions || isCached;
  const newChatDisabled = disableNewChat || pending?.type === "materialize";
  const threadItemsDisabled = actionsDisabled || isNavigatingThread;
  const visibleThreads = (view === "archived" ? archivedThreads : threads).filter(
    (thread) => !deletingThreadIds.has(thread.threadId),
  );
  const loadingArchived = view === "archived" && isLoadingArchivedThreads;
  const loadingInitialThreads = isInitialLoading && visibleThreads.length === 0;
  const visibleError =
    view === "archived" ? (archiveError ?? archivedThreadsError) : (archiveError ?? error);
  const headerLabel = view === "archived" ? "Archived chats" : "Recent chats";

  useEffect(() => {
    if (view !== "archived" || actionsDisabled) return;
    let cancelled = false;
    setArchiveError(null);
    loadArchivedThreads().catch((nextError) => {
      if (!cancelled) {
        setArchiveError(
          nextError instanceof Error ? nextError.message : "Failed to load archived chats",
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [actionsDisabled, loadArchivedThreads, view]);

  const reloadArchived = async () => {
    if (view !== "archived") return;
    setArchiveError(null);
    try {
      await loadArchivedThreads();
    } catch (nextError) {
      setArchiveError(
        nextError instanceof Error ? nextError.message : "Failed to load archived chats",
      );
    }
  };

  const runThreadAction = async (action: () => Promise<void>, fallback: string) => {
    setArchiveError(null);
    try {
      await action();
    } catch (nextError) {
      setArchiveError(nextError instanceof Error ? nextError.message : fallback);
    }
  };

  const handleCreateThread = async () => {
    if (newChatDisabled) return;
    focusComposer();
    startNewSession();
    window.setTimeout(focusComposer, 0);
  };

  const handleActivateThread = async (threadId: string) => {
    if (threadItemsDisabled) return;
    focusComposer();
    await runThreadAction(async () => {
      await activateThread(threadId);
      focusComposer();
    }, "Failed to switch chat");
  };

  const handleRename = async (thread: ChatThreadSummary) => {
    if (actionsDisabled) return;
    const nextTitle = window.prompt("Rename chat", thread.title || "New chat");
    if (nextTitle === null) return;
    const title = nextTitle.trim();
    if (!title || title === thread.title) return;
    await runThreadAction(async () => {
      await renameThread(thread.threadId, title);
      await reloadArchived();
    }, "Failed to rename chat");
  };

  const handleArchive = async (thread: ChatThreadSummary) => {
    if (actionsDisabled || thread.latestRunStatus === "running") return;
    await runThreadAction(async () => {
      await archiveThread(thread.threadId);
      await reloadArchived();
    }, "Failed to archive chat");
  };

  const handleRestore = async (thread: ChatThreadSummary) => {
    if (actionsDisabled) return;
    await runThreadAction(async () => {
      await restoreThread(thread.threadId);
      await reloadArchived();
    }, "Failed to restore chat");
  };

  const handleDelete = async (thread: ChatThreadSummary) => {
    if (actionsDisabled || thread.latestRunStatus === "running") return;
    const confirmed = window.confirm(
      `Delete "${thread.title || "New chat"}"? This hides the chat but keeps its audit records.`,
    );
    if (!confirmed) return;
    await runThreadAction(async () => {
      await deleteThread(thread.threadId);
      await reloadArchived();
    }, "Failed to delete chat");
  };

  return (
    <aside className="border-border bg-background/95 absolute inset-y-0 left-0 z-10 hidden w-64 flex-col border-r backdrop-blur md:flex">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="border-border flex items-center justify-between gap-2 border-b px-3 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <MessageSquareIcon className="text-muted-foreground size-4 shrink-0" />
            <span className="truncate text-sm font-medium">{headerLabel}</span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={newChatDisabled}
            aria-label="New chat"
            title="New chat"
            onClick={() => void handleCreateThread()}
          >
            {creatingThread ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <PlusIcon className="size-4" />
            )}
          </Button>
        </div>

        <div className="border-border flex gap-1 border-b px-2 py-2">
          <Button
            type="button"
            variant={view === "active" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 flex-1 text-xs"
            onClick={() => setView("active")}
          >
            Recent
          </Button>
          <Button
            type="button"
            variant={view === "archived" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 flex-1 text-xs"
            onClick={() => setView("archived")}
          >
            Archived
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {visibleError && visibleThreads.length === 0 ? (
            <div className="text-muted-foreground px-2 py-2 text-xs">{visibleError}</div>
          ) : loadingInitialThreads ? (
            <div className="text-muted-foreground px-2 py-2 text-xs">Loading chats...</div>
          ) : loadingArchived ? (
            <div className="text-muted-foreground px-2 py-2 text-xs">Loading archived chats...</div>
          ) : visibleThreads.length === 0 ? (
            <div className="text-muted-foreground px-2 py-2 text-xs">
              {view === "archived" ? "No archived chats." : "No recent chats yet."}
            </div>
          ) : (
            <>
              {visibleError ? (
                <div className="text-destructive px-2 pb-2 text-[11px]">{visibleError}</div>
              ) : null}
              {visibleThreads.map((thread) => (
                <ThreadHistoryItem
                  key={thread.threadId}
                  thread={thread}
                  view={view}
                  disabled={threadItemsDisabled}
                  pending={pending}
                  onActivate={handleActivateThread}
                  onRename={handleRename}
                  onArchive={handleArchive}
                  onRestore={handleRestore}
                  onDelete={handleDelete}
                />
              ))}
            </>
          )}
        </div>
      </div>
    </aside>
  );
}

function ThreadHistoryItem({
  thread,
  view,
  disabled = false,
  pending,
  onActivate,
  onRename,
  onArchive,
  onRestore,
  onDelete,
}: {
  thread: ChatThreadSummary;
  view: "active" | "archived";
  disabled?: boolean;
  pending: ReturnType<typeof useWorkbenchAgentConnection>["pending"];
  onActivate: (threadId: string) => Promise<void>;
  onRename: (thread: ChatThreadSummary) => Promise<void>;
  onArchive: (thread: ChatThreadSummary) => Promise<void>;
  onRestore: (thread: ChatThreadSummary) => Promise<void>;
  onDelete: (thread: ChatThreadSummary) => Promise<void>;
}) {
  const pendingActivation = pending?.type === "activate" && pending.threadId === thread.threadId;
  const pendingThreadId = pending && "threadId" in pending ? pending.threadId : null;
  const pendingType = pending?.type;
  const pendingMutation =
    pendingThreadId === thread.threadId &&
    (pendingType === "rename" ||
      pendingType === "archive" ||
      pendingType === "restore" ||
      pendingType === "delete");
  const hasRunningRun = thread.latestRunStatus === "running";
  const actionButtonsDisabled = disabled || pendingActivation || pendingMutation;
  const activationDisabled = actionButtonsDisabled || thread.isActive;
  const canActivate = view === "active";

  return (
    <div
      className={cn(
        "hover:bg-muted/70 mb-1 flex w-full min-w-0 items-center gap-1 rounded-md px-1 py-1 text-sm transition-colors",
        thread.isActive && "bg-muted",
      )}
    >
      <button
        type="button"
        disabled={activationDisabled || !canActivate}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-1 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-70",
          pendingActivation && "disabled:cursor-wait",
        )}
        onClick={() => {
          if (thread.isActive) return;
          void onActivate(thread.threadId);
        }}
      >
        {pendingActivation || pendingMutation ? (
          <Loader2Icon className="text-muted-foreground size-3.5 shrink-0 animate-spin" />
        ) : (
          <MessageSquareIcon className="text-muted-foreground size-3.5 shrink-0" />
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate">{thread.title || "New chat"}</span>
          {thread.agent ? (
            <span className="text-muted-foreground truncate text-[11px]">
              {thread.agent.name} / {thread.agent.profile}
            </span>
          ) : null}
        </span>
        {thread.messageCount ? (
          <span className="text-muted-foreground shrink-0 text-[10px] tabular-nums">
            {thread.messageCount}
          </span>
        ) : null}
      </button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="size-7 shrink-0"
        disabled={actionButtonsDisabled}
        title="Rename"
        aria-label="Rename chat"
        onClick={() => void onRename(thread)}
      >
        <PencilIcon className="size-3.5" />
      </Button>
      {view === "archived" ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7 shrink-0"
          disabled={actionButtonsDisabled}
          title="Restore"
          aria-label="Restore chat"
          onClick={() => void onRestore(thread)}
        >
          <ArchiveRestoreIcon className="size-3.5" />
        </Button>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7 shrink-0"
          disabled={actionButtonsDisabled || hasRunningRun}
          title={hasRunningRun ? "Wait for the running response to finish" : "Archive"}
          aria-label="Archive chat"
          onClick={() => void onArchive(thread)}
        >
          <ArchiveIcon className="size-3.5" />
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="text-destructive hover:text-destructive size-7 shrink-0"
        disabled={actionButtonsDisabled || hasRunningRun}
        title={hasRunningRun ? "Wait for the running response to finish" : "Delete"}
        aria-label="Delete chat"
        onClick={() => void onDelete(thread)}
      >
        <Trash2Icon className="size-3.5" />
      </Button>
    </div>
  );
}
