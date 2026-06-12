"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuiState } from "@assistant-ui/react";
import { MessageSquareIcon, PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  requestWorkbenchSummaryRefresh,
  workbenchSummaryRefreshEvent,
} from "@/lib/workbench/admin-summary-events";
import {
  requestWorkbenchAgentNewChat,
  requestWorkbenchAgentThread,
  workbenchAgentNewChatEvent,
  workbenchAgentSelectThreadEvent,
} from "@/lib/workbench/agent-chat-events";
import { cn } from "@/lib/utils";
import type { ChatSessionResponse, ChatThreadSummary } from "@/lib/workbench/workbench-types";

export function ThreadHistorySidebar() {
  const isRunning = useAuiState((state) => state.thread.isRunning);
  const [threads, setThreads] = useState<ChatThreadSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadThreads = useCallback(async () => {
    try {
      setError(null);
      const response = await fetch("/api/workbench/chat-session", {
        cache: "no-store",
      });
      const body = (await response.json().catch(() => ({}))) as ChatSessionResponse & {
        error?: string;
      };
      if (!response.ok || !body.ok) {
        throw new Error(body.error ?? "Failed to load recent chats");
      }
      setThreads(body.threads ?? []);
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "Failed to load chats";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadThreads();
    const delayedLoad = () => window.setTimeout(() => void loadThreads(), 400);
    window.addEventListener(workbenchSummaryRefreshEvent, delayedLoad);
    window.addEventListener(workbenchAgentNewChatEvent, delayedLoad);
    window.addEventListener(workbenchAgentSelectThreadEvent, delayedLoad);
    return () => {
      window.removeEventListener(workbenchSummaryRefreshEvent, delayedLoad);
      window.removeEventListener(workbenchAgentNewChatEvent, delayedLoad);
      window.removeEventListener(workbenchAgentSelectThreadEvent, delayedLoad);
    };
  }, [loadThreads]);

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
            disabled={isRunning || isLoading}
            aria-label="New chat"
            title="New chat"
            onClick={() => {
              requestWorkbenchSummaryRefresh();
              requestWorkbenchAgentNewChat();
              window.setTimeout(requestWorkbenchSummaryRefresh, 500);
            }}
          >
            <PlusIcon className="size-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {error ? (
            <div className="text-muted-foreground px-2 py-2 text-xs">{error}</div>
          ) : isLoading ? (
            <div className="text-muted-foreground px-2 py-2 text-xs">Loading chats...</div>
          ) : threads.length === 0 ? (
            <div className="text-muted-foreground px-2 py-2 text-xs">No recent chats yet.</div>
          ) : (
            threads.map((thread) => <ThreadHistoryItem key={thread.threadId} thread={thread} />)
          )}
        </div>
      </div>
    </aside>
  );
}

function ThreadHistoryItem({ thread }: { thread: ChatThreadSummary }) {
  return (
    <button
      type="button"
      className={cn(
        "hover:bg-muted/70 mb-1 flex w-full min-w-0 items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
        thread.isActive && "bg-muted",
      )}
      onClick={() => {
        requestWorkbenchSummaryRefresh();
        requestWorkbenchAgentThread(thread.threadId);
        window.setTimeout(requestWorkbenchSummaryRefresh, 500);
      }}
    >
      <MessageSquareIcon className="text-muted-foreground size-3.5 shrink-0" />
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
