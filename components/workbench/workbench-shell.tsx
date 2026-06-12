"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@workos-inc/authkit-nextjs/components";
import { MessageSquarePlusIcon, ShieldCheckIcon } from "lucide-react";

import { Assistant } from "@/app/assistant";
import {
  AssistantSlashCommandProvider,
  type AssistantSlashCommandContext,
} from "@/components/assistant-ui/slash-command-context";
import { AuthButton } from "@/components/auth/auth-button";
import { WorkbenchComposerFocusProvider } from "@/components/workbench/composer-focus-context";
import { AdminPanel } from "@/components/workbench/dev-monitor-drawer";
import { ThreadHistorySidebar } from "@/components/workbench/thread-history-sidebar";
import { WorkbenchAssistantEvents } from "@/components/workbench/workbench-assistant-events";
import { WorkbenchRuntimeHint } from "@/components/workbench/workbench-runtime-hint";
import { requestWorkbenchAgentNewChat } from "@/lib/workbench/agent-chat-events";
import { requestWorkbenchSummaryRefresh } from "@/lib/workbench/admin-summary-events";

const adminAccessPath = "/api/workbench/admin-access";

export function WorkbenchShell() {
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminAccess, setAdminAccess] = useState<{ isAdmin: boolean } | null>(null);
  const [adminNotice, setAdminNotice] = useState<string | null>(null);
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;

    let cancelled = false;
    const loadAdminAccess = async () => {
      try {
        const response = await fetch(adminAccessPath, { cache: "no-store" });
        if (!response.ok) {
          if (!cancelled) setAdminAccess({ isAdmin: false });
          return;
        }
        const body = (await response.json().catch(() => ({}))) as { isAdmin?: unknown };
        if (!cancelled) setAdminAccess({ isAdmin: body.isAdmin === true });
      } catch {
        if (!cancelled) setAdminAccess({ isAdmin: false });
      }
    };

    void loadAdminAccess();
    return () => {
      cancelled = true;
    };
  }, [loading, user?.email, user?.id]);

  const openAdmin = useCallback(() => {
    if (adminAccess?.isAdmin) {
      setAdminNotice(null);
      setAdminOpen(true);
      return;
    }

    setAdminOpen(false);
    setAdminNotice("Admin is restricted for this account.");
    window.setTimeout(() => setAdminNotice(null), 3000);
  }, [adminAccess?.isAdmin]);

  const startNewChat = useCallback(
    async ({ isLoadingThread, isThreadRunning }: AssistantSlashCommandContext) => {
      if (isThreadRunning || isLoadingThread) {
        setAdminNotice("Wait for the current response before starting a new chat.");
        window.setTimeout(() => setAdminNotice(null), 3000);
        return;
      }

      requestWorkbenchSummaryRefresh();
      requestWorkbenchAgentNewChat();
      window.setTimeout(requestWorkbenchSummaryRefresh, 500);
    },
    [],
  );

  const slashCommands = useMemo(
    () => [
      {
        id: "new",
        label: "New chat",
        description: "Start a fresh thread in the current workspace.",
        icon: MessageSquarePlusIcon,
        execute: startNewChat,
      },
      {
        id: "admin",
        label: "Admin",
        description: adminAccess?.isAdmin
          ? "Open workspace, agent, and runtime controls."
          : "Restricted operator panel.",
        icon: ShieldCheckIcon,
        execute: openAdmin,
      },
    ],
    [adminAccess?.isAdmin, openAdmin, startNewChat],
  );

  return (
    <div className="bg-background relative h-dvh overflow-hidden">
      <WorkbenchComposerFocusProvider>
        <AssistantSlashCommandProvider commands={slashCommands}>
          <div className="absolute top-3 right-3 z-30 flex max-w-[calc(100vw-1.5rem)] flex-col items-end gap-2">
            <AuthButton />
            {adminNotice ? (
              <div className="border-border bg-background/95 text-muted-foreground rounded-md border px-2.5 py-1.5 text-xs shadow-xs backdrop-blur">
                {adminNotice}
              </div>
            ) : null}
          </div>
          <Assistant>
            <ThreadHistorySidebar />
            <WorkbenchAssistantEvents />
            <div className="absolute top-14 right-3 z-20 flex max-w-[calc(100vw-1.5rem)] flex-col items-end gap-2">
              <WorkbenchRuntimeHint onOpenAdmin={openAdmin} />
            </div>
            <AdminPanel open={adminOpen} onOpenChange={setAdminOpen} />
          </Assistant>
        </AssistantSlashCommandProvider>
      </WorkbenchComposerFocusProvider>
    </div>
  );
}
