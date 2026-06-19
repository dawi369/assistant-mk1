"use client";

import { useAuiState } from "@assistant-ui/react";
import { MessageSquarePlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useWorkbenchAgentConnection } from "@/lib/workbench/use-agent-connection";

export function NewChatButton({
  className,
  label = "New chat",
}: {
  className?: string;
  label?: string;
}) {
  const isRunning = useAuiState((state) => state.thread.isRunning);
  const isLoadingThread = useAuiState((state) => state.threads.isLoading);
  const { startNewSession } = useWorkbenchAgentConnection();
  const disabled = isRunning || isLoadingThread;

  const startNewChat = () => {
    if (disabled) return;
    startNewSession();
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
      <MessageSquarePlusIcon className="size-4" />
      {label}
    </Button>
  );
}
