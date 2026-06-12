"use client";

import { useState } from "react";
import { useAuiState } from "@assistant-ui/react";
import { Loader2Icon, MessageSquarePlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { requestWorkbenchAgentNewChat } from "@/lib/workbench/agent-chat-events";
import { requestWorkbenchSummaryRefresh } from "@/lib/workbench/admin-summary-events";
import { cn } from "@/lib/utils";

export function NewChatButton({
  className,
  label = "New chat",
}: {
  className?: string;
  label?: string;
}) {
  const isRunning = useAuiState((state) => state.thread.isRunning);
  const isLoadingThread = useAuiState((state) => state.threads.isLoading);
  const [isResetting, setIsResetting] = useState(false);
  const disabled = isRunning || isLoadingThread || isResetting;

  const startNewChat = () => {
    if (disabled) return;
    setIsResetting(true);
    requestWorkbenchSummaryRefresh();
    requestWorkbenchAgentNewChat();
    window.setTimeout(requestWorkbenchSummaryRefresh, 500);
    window.setTimeout(() => setIsResetting(false), 750);
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn("bg-background/95 shadow-xs", className)}
      disabled={disabled}
      title={
        isRunning ? "Wait for the current response to finish before starting a new chat" : label
      }
      onClick={startNewChat}
    >
      {isResetting ? (
        <Loader2Icon className="size-4 animate-spin" />
      ) : (
        <MessageSquarePlusIcon className="size-4" />
      )}
      {label}
    </Button>
  );
}
