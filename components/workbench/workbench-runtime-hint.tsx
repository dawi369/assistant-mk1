"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@workos-inc/authkit-nextjs/components";
import { AlertCircleIcon, BotIcon, Building2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { chatRuntimeStateLabel, chatRuntimeStateTone } from "@/lib/workbench/chat-runtime-display";
import type { CloudflareAdminSummaryResponse } from "@/lib/workbench/workbench-types";
import { cn } from "@/lib/utils";

const adminSummaryPath = "/api/workbench/admin-summary";
const refreshIntervalMs = 3000;

const readSummary = async () => {
  const response = await fetch(adminSummaryPath, { cache: "no-store" });
  if (!response.ok) return null;
  const body = (await response.json().catch(() => ({}))) as CloudflareAdminSummaryResponse;
  return body.summary ?? null;
};

export function WorkbenchRuntimeHint({ onOpenMonitor }: { onOpenMonitor: () => void }) {
  const [summary, setSummary] = useState<CloudflareAdminSummaryResponse["summary"] | null>(null);
  const { user, loading } = useAuth();

  const loadSummary = async () => {
    try {
      const nextSummary = await readSummary();
      setSummary(nextSummary);
    } catch {
      setSummary(null);
    }
  };

  useEffect(() => {
    if (loading) return;
    if (!user) {
      setSummary(null);
      return;
    }

    void loadSummary();
    const interval = window.setInterval(() => void loadSummary(), refreshIntervalMs);
    return () => window.clearInterval(interval);
  }, [loading, user]);

  const chatRuntime = summary?.chatRuntime ?? null;
  const hasError = Boolean(chatRuntime?.failure ?? summary?.lastError);
  const chatLabel = chatRuntimeStateLabel(chatRuntime?.state);
  const chatTone = chatRuntimeStateTone(chatRuntime?.state);
  const agentLabel = summary?.activeAgent
    ? `${summary.activeAgent.name} / ${summary.activeAgent.profile}`
    : null;

  const statusClassName = useMemo(() => {
    switch (chatTone) {
      case "completed":
        return "border-emerald-200 bg-emerald-50 text-emerald-700";
      case "running":
        return "border-sky-200 bg-sky-50 text-sky-700";
      case "failed":
        return "border-destructive/30 bg-destructive/10 text-destructive";
      default:
        return "border-border bg-muted text-muted-foreground";
    }
  }, [chatTone]);

  if (!summary) return null;

  return (
    <div className="border-border bg-background/95 text-muted-foreground hidden max-w-[min(54vw,34rem)] items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs shadow-xs backdrop-blur md:flex">
      <span className={cn("rounded-md border px-2 py-0.5 font-medium", statusClassName)}>
        {chatLabel}
      </span>
      <span className="flex min-w-0 items-center gap-1">
        <Building2Icon className="size-3.5 shrink-0" />
        <span className="truncate">{summary.workspace?.name ?? "Workspace"}</span>
      </span>
      <span className="flex min-w-0 items-center gap-1">
        <BotIcon className="size-3.5 shrink-0" />
        <span className="truncate">{agentLabel ?? "Agent"}</span>
      </span>
      {hasError ? (
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive h-6 shrink-0 gap-1 px-1.5 text-xs"
          onClick={onOpenMonitor}
        >
          <AlertCircleIcon className="size-3.5" />
          Details
        </Button>
      ) : null}
    </div>
  );
}
