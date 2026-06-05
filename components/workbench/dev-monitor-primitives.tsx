"use client";

import { useState, type ReactNode } from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  CircleIcon,
  ClipboardIcon,
  Loader2Icon,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export const terminalStatuses = new Set(["completed", "failed", "cancelled"]);

export const statusTone = (status?: string) => {
  switch (status) {
    case "completed":
      return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300";
    case "running":
      return "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-300";
    case "queued":
      return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300";
    case "failed":
    case "cancelled":
      return "border-destructive/30 bg-destructive/10 text-destructive";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
};

export const formatTime = (value?: string) => {
  if (!value) return "Pending";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
};

const shortId = (value?: string | null) => {
  if (!value) return "not available";
  if (value.length <= 18) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
};

export function MonitorSection({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="border-border bg-background rounded-lg border p-4">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="text-muted-foreground size-4" />
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export function StatusRow({
  label,
  value,
  compact,
  tone = "muted",
}: {
  label: string;
  value?: string | null;
  compact?: boolean;
  tone?: "muted" | "ok";
}) {
  return (
    <div className={cn("min-w-0", compact ? "rounded-md border p-2" : "")}>
      <p className="text-muted-foreground text-xs">{label}</p>
      <p
        className={cn(
          "mt-0.5 truncate text-sm",
          tone === "ok" ? "text-foreground font-medium" : "text-muted-foreground",
        )}
      >
        {value || "not available"}
      </p>
    </div>
  );
}

export function StatusPill({ status, tone }: { status: string; tone?: string }) {
  const active = tone && !terminalStatuses.has(tone);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium",
        statusTone(tone),
      )}
    >
      {active ? (
        <Loader2Icon className="mr-1 size-3 animate-spin" />
      ) : tone === "completed" ? (
        <CheckIcon className="mr-1 size-3" />
      ) : (
        <CircleIcon className="mr-1 size-3" />
      )}
      {status}
    </span>
  );
}

export function CopyId({ label, value }: { label: string; value?: string | null }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <Collapsible>
      <div className="flex items-center justify-between gap-2">
        <CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex min-w-0 items-center gap-1 text-xs">
          <ChevronDownIcon className="size-3" />
          {label}
        </CollapsibleTrigger>
        <Button variant="ghost" size="icon-xs" onClick={copy} disabled={!value}>
          {copied ? <CheckIcon /> : <ClipboardIcon />}
          <span className="sr-only">Copy {label}</span>
        </Button>
      </div>
      <p className="text-muted-foreground font-mono text-xs">{shortId(value)}</p>
      <CollapsibleContent>
        <p className="bg-muted mt-2 rounded-md px-2 py-1 font-mono text-xs break-all">
          {value || "not available"}
        </p>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function RuntimeRecord({
  icon: Icon,
  label,
  title,
  detail,
  status,
}: {
  icon: LucideIcon;
  label: string;
  title: string;
  detail?: string | null;
  status?: string;
}) {
  return (
    <div className="border-border rounded-md border p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <Icon className="size-3.5" />
          {label}
        </span>
        {status ? <StatusPill status={status} tone={status} /> : null}
      </div>
      <p className="mt-1 truncate font-medium">{title}</p>
      {detail ? <p className="text-muted-foreground mt-1 text-xs">{detail}</p> : null}
    </div>
  );
}

export function EmptyPanelText({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground text-sm">{children}</p>;
}
