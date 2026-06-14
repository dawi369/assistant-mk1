"use client";

import { useAuiState } from "@assistant-ui/react";
import { Loader2Icon, MessageSquareIcon, PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
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
    connection,
    session,
    threads,
    pending,
    error,
    isInitialLoading,
    isTransitioning,
    createThread,
  } = useWorkbenchAgentConnection();
  const creatingThread = pending?.type === "create";
  const isCached = session?.isStale === true;
  const actionsDisabled = disableThreadActions || !connection || isCached;

  return (
    <aside className="border-border bg-background/95 absolute inset-y-0 left-0 z-10 hidden w-64 flex-col border-r backdrop-blur md:flex">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="border-border flex items-center justify-between gap-2 border-b px-3 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <MessageSquareIcon className="text-muted-foreground size-4 shrink-0" />
            <span className="truncate text-sm font-medium">Recent chats</span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={disableNewChat || creatingThread || actionsDisabled}
            aria-label="New chat"
            title={actionsDisabled ? "Connect to Cloudflare before starting a chat" : "New chat"}
            onClick={() => void createThread()}
          >
            {creatingThread ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <PlusIcon className="size-4" />
            )}
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {error && threads.length === 0 ? (
            <div className="text-muted-foreground px-2 py-2 text-xs">{error}</div>
          ) : isInitialLoading ? (
            <div className="text-muted-foreground px-2 py-2 text-xs">Loading chats...</div>
          ) : threads.length === 0 ? (
            <div className="text-muted-foreground px-2 py-2 text-xs">No recent chats yet.</div>
          ) : (
            <>
              {isCached ? (
                <div className="text-muted-foreground px-2 pb-2 text-[11px]">
                  Showing cached chats while Cloudflare connects...
                </div>
              ) : isTransitioning ? (
                <div className="text-muted-foreground px-2 pb-2 text-[11px]">
                  Switching thread...
                </div>
              ) : null}
              {threads.map((thread) => (
                <ThreadHistoryItem
                  key={thread.threadId}
                  thread={thread}
                  disabled={actionsDisabled}
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
  disabled = false,
}: {
  thread: ChatThreadSummary;
  disabled?: boolean;
}) {
  const { activateThread, pending } = useWorkbenchAgentConnection();
  const pendingActivation = pending?.type === "activate" && pending.threadId === thread.threadId;
  const isDisabled = disabled || pendingActivation;

  return (
    <button
      type="button"
      disabled={isDisabled}
      className={cn(
        "hover:bg-muted/70 mb-1 flex w-full min-w-0 items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-70",
        pendingActivation && "disabled:cursor-wait",
        thread.isActive && "bg-muted",
      )}
      onClick={() => void activateThread(thread.threadId)}
    >
      {pendingActivation ? (
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
  );
}
