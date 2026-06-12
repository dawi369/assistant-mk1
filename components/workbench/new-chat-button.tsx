"use client";

import { useState } from "react";
import { useAuiState } from "@assistant-ui/react";
import { Loader2Icon, MessageSquarePlusIcon } from "lucide-react";

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
  const { createThread, pending } = useWorkbenchAgentConnection();
  const [isResetting, setIsResetting] = useState(false);
  const creatingThread = pending?.type === "create";
  const disabled = isRunning || isLoadingThread || isResetting || creatingThread;

  const startNewChat = async () => {
    if (disabled) return;
    setIsResetting(true);
    try {
      await createThread();
    } finally {
      setIsResetting(false);
    }
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
      {isResetting || creatingThread ? (
        <Loader2Icon className="size-4 animate-spin" />
      ) : (
        <MessageSquarePlusIcon className="size-4" />
      )}
      {label}
    </Button>
  );
}
