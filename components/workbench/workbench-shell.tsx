"use client";

import { useState } from "react";

import { Assistant } from "@/app/assistant";
import { AuthButton } from "@/components/auth/auth-button";
import { DevMonitorDrawer } from "@/components/workbench/dev-monitor-drawer";
import { NewChatButton } from "@/components/workbench/new-chat-button";
import { ThreadHistorySidebar } from "@/components/workbench/thread-history-sidebar";
import { WorkbenchAssistantEvents } from "@/components/workbench/workbench-assistant-events";
import { WorkbenchRuntimeHint } from "@/components/workbench/workbench-runtime-hint";

export function WorkbenchShell() {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="bg-background relative h-dvh overflow-hidden">
      <Assistant>
        <WorkbenchAssistantEvents />
        <ThreadHistorySidebar />
        <div className="absolute top-3 right-3 z-20 flex max-w-[calc(100vw-1.5rem)] flex-col items-end gap-2">
          <div className="flex items-center justify-end gap-2">
            <AuthButton />
            <NewChatButton />
            <DevMonitorDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />
          </div>
          <WorkbenchRuntimeHint onOpenMonitor={() => setDrawerOpen(true)} />
        </div>
      </Assistant>
    </div>
  );
}
