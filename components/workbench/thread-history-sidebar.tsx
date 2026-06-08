"use client";

import { ThreadListItemPrimitive, ThreadListPrimitive, useAuiState } from "@assistant-ui/react";
import { MessageSquareIcon, PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { requestWorkbenchSummaryRefresh } from "@/lib/workbench/admin-summary-events";
import { cn } from "@/lib/utils";

export function ThreadHistorySidebar() {
  const isRunning = useAuiState((state) => state.thread.isRunning);
  const isLoading = useAuiState((state) => state.threads.isLoading);

  return (
    <aside className="border-border bg-background/95 absolute inset-y-0 left-0 z-10 hidden w-64 flex-col border-r backdrop-blur md:flex">
      <ThreadListPrimitive.Root className="flex min-h-0 flex-1 flex-col">
        <div className="border-border flex items-center justify-between gap-2 border-b px-3 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <MessageSquareIcon className="text-muted-foreground size-4 shrink-0" />
            <span className="truncate text-sm font-medium">Recent chats</span>
          </div>
          <ThreadListPrimitive.New asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={isRunning || isLoading}
              aria-label="New chat"
              title="New chat"
              onClick={() => {
                requestWorkbenchSummaryRefresh();
                window.setTimeout(requestWorkbenchSummaryRefresh, 500);
              }}
            >
              <PlusIcon className="size-4" />
            </Button>
          </ThreadListPrimitive.New>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          <ThreadListPrimitive.Items>{() => <ThreadHistoryItem />}</ThreadListPrimitive.Items>
        </div>
      </ThreadListPrimitive.Root>
    </aside>
  );
}

function ThreadHistoryItem() {
  return (
    <ThreadListItemPrimitive.Root className="group mb-1">
      <ThreadListItemPrimitive.Trigger asChild>
        <button
          type="button"
          className={cn(
            "hover:bg-muted/70 group-data-[active=true]:bg-muted group-data-[active]:bg-muted flex w-full min-w-0 items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
          )}
          onClick={() => {
            requestWorkbenchSummaryRefresh();
            window.setTimeout(requestWorkbenchSummaryRefresh, 500);
          }}
        >
          <MessageSquareIcon className="text-muted-foreground size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            <ThreadListItemPrimitive.Title fallback="New chat" />
          </span>
        </button>
      </ThreadListItemPrimitive.Trigger>
    </ThreadListItemPrimitive.Root>
  );
}
