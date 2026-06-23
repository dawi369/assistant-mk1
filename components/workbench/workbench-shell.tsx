"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@workos-inc/authkit-nextjs/components";
import {
  ActivityIcon,
  FileTextIcon,
  HistoryIcon,
  MessageSquarePlusIcon,
  PlayIcon,
  ShieldCheckIcon,
} from "lucide-react";

import { Assistant } from "@/app/assistant";
import {
  AssistantSlashCommandProvider,
  type AssistantSlashCommandContext,
} from "@/components/assistant-ui/slash-command-context";
import { AuthButton } from "@/components/auth/auth-button";
import {
  useWorkbenchComposerFocus,
  WorkbenchComposerFocusProvider,
} from "@/components/workbench/composer-focus-context";
import { AdminPanel } from "@/components/workbench/dev-monitor-drawer";
import { ThreadHistorySidebar } from "@/components/workbench/thread-history-sidebar";
import { WorkbenchAssistantEvents } from "@/components/workbench/workbench-assistant-events";
import { WorkbenchHistoryPanel } from "@/components/workbench/workbench-history-panel";
import { WorkbenchRuntimeHint } from "@/components/workbench/workbench-runtime-hint";
import { requestWorkbenchSummaryRefresh } from "@/lib/workbench/admin-summary-events";
import {
  ChatSessionProvider,
  useWorkbenchAgentConnection,
} from "@/lib/workbench/use-agent-connection";
import type { RunnableAdminToolName } from "@/lib/workbench/cloudflare-control-plane-client";

const adminAccessPath = "/api/workbench/admin-access";
const toolRunsPath = "/api/workbench/tools/runs";

const adminTestToolInputs: Record<
  Extract<RunnableAdminToolName, "diagnostic.ping" | "runner.echo" | "artifact.metadata.test">,
  Record<string, unknown>
> = {
  "diagnostic.ping": {},
  "runner.echo": { message: "runner echo ok" },
  "artifact.metadata.test": { label: "admin conformance" },
};

export function WorkbenchShell() {
  return (
    <ChatSessionProvider>
      <WorkbenchComposerFocusProvider>
        <WorkbenchShellContent />
      </WorkbenchComposerFocusProvider>
    </ChatSessionProvider>
  );
}

function WorkbenchShellContent() {
  const [adminOpen, setAdminOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [adminAccess, setAdminAccess] = useState<{ isAdmin: boolean } | null>(null);
  const [adminNotice, setAdminNotice] = useState<string | null>(null);
  const { user, loading } = useAuth();
  const { isInitialLoading, startNewSession } = useWorkbenchAgentConnection();
  const { focusComposerAfterInteraction } = useWorkbenchComposerFocus();

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

      startNewSession();
      focusComposerAfterInteraction();
    },
    [focusComposerAfterInteraction, startNewSession],
  );

  const runAdminTestTool = useCallback(
    async (toolName: keyof typeof adminTestToolInputs) => {
      if (!adminAccess?.isAdmin) {
        setAdminNotice("Admin tools are restricted for this account.");
        window.setTimeout(() => setAdminNotice(null), 3000);
        return;
      }

      setAdminNotice(`Running ${toolName}...`);
      try {
        const response = await fetch(toolRunsPath, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            toolName,
            executionMode: "dry_run",
            input: adminTestToolInputs[toolName],
          }),
        });
        const body = (await response.json().catch(() => ({}))) as { error?: unknown };
        if (!response.ok) {
          throw new Error(
            typeof body.error === "string" ? body.error : `Failed to run ${toolName}`,
          );
        }
        setAdminNotice(`${toolName} accepted.`);
        requestWorkbenchSummaryRefresh({ source: "event" });
      } catch (error) {
        setAdminNotice(error instanceof Error ? error.message : `Failed to run ${toolName}`);
        requestWorkbenchSummaryRefresh({ source: "event" });
      } finally {
        focusComposerAfterInteraction();
        window.setTimeout(() => setAdminNotice(null), 3000);
      }
    },
    [adminAccess?.isAdmin, focusComposerAfterInteraction],
  );

  const slashCommands = useMemo(() => {
    const commands = [
      {
        id: "new",
        label: "New chat",
        description: "Start a fresh thread in the current workspace.",
        icon: MessageSquarePlusIcon,
        execute: startNewChat,
      },
      {
        id: "history",
        label: "History",
        description: "Inspect recent scoped runs and artifacts.",
        icon: HistoryIcon,
        execute: () => setHistoryOpen(true),
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
    ];

    if (!adminAccess?.isAdmin) return commands;

    return [
      ...commands,
      {
        id: "ping",
        label: "Diagnostic ping",
        description: "Run diagnostic.ping as an Admin dry-run.",
        icon: ActivityIcon,
        execute: () => runAdminTestTool("diagnostic.ping"),
      },
      {
        id: "echo",
        label: "Runner echo",
        description: "Run runner.echo through the Fly callback path.",
        icon: PlayIcon,
        execute: () => runAdminTestTool("runner.echo"),
      },
      {
        id: "artifact",
        label: "Artifact metadata test",
        description: "Run artifact.metadata.test and create metadata history.",
        icon: FileTextIcon,
        execute: () => runAdminTestTool("artifact.metadata.test"),
      },
    ];
  }, [adminAccess?.isAdmin, openAdmin, runAdminTestTool, startNewChat]);

  return (
    <div className="bg-background relative h-dvh overflow-hidden">
      <AssistantSlashCommandProvider commands={slashCommands}>
        <div className="absolute top-3 right-3 z-30 flex max-w-[calc(100vw-1.5rem)] flex-col items-end gap-2">
          <AuthButton />
          {adminNotice ? (
            <div className="border-border bg-background/95 text-muted-foreground rounded-md border px-2.5 py-1.5 text-xs shadow-xs backdrop-blur">
              {adminNotice}
            </div>
          ) : null}
        </div>
        <ThreadHistorySidebar disableNewChat={false} disableThreadActions={isInitialLoading} />
        <div className="absolute top-14 right-3 z-20 flex max-w-[calc(100vw-1.5rem)] flex-col items-end gap-2">
          <WorkbenchRuntimeHint onOpenAdmin={openAdmin} />
        </div>
        <Assistant>
          <WorkbenchAssistantEvents />
        </Assistant>
        <WorkbenchHistoryPanel open={historyOpen} onOpenChange={setHistoryOpen} />
        <AdminPanel open={adminOpen} onOpenChange={setAdminOpen} />
      </AssistantSlashCommandProvider>
    </div>
  );
}
