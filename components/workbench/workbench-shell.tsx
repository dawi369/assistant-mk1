"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ActivityIcon,
  AlertCircleIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleIcon,
  ClipboardIcon,
  FileTextIcon,
  HistoryIcon,
  Loader2Icon,
  MessageSquareIcon,
  PanelRightOpenIcon,
  PlayIcon,
  ShieldCheckIcon,
  UserIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";

import { Assistant } from "@/app/assistant";
import { AuthButton } from "@/components/auth/auth-button";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type WorkbenchDisplaySnapshot = {
  intent: {
    type?: string;
  } | null;
  run: {
    id?: string;
    status?: string;
    execution?: {
      mode?: string;
    };
    stage?: string;
    updatedAt?: string;
  } | null;
  toolCalls: Array<{
    id: string;
    toolId?: string;
    status?: string;
    inputSummary?: string;
    outputSummary?: string;
  }>;
  artifacts: Array<{
    id: string;
    title?: string;
    uri?: string;
    mimeType?: string;
  }>;
  decisions: Array<{
    id: string;
    title?: string;
    summary?: string;
    thesis?: string;
  }>;
  auditEvents: Array<{
    id: string;
    action?: string;
    summary?: string;
    createdAt?: string;
  }>;
};

type DemoRunResponse = {
  snapshot: WorkbenchDisplaySnapshot | null;
  error?: string;
};

type ControlPlaneEvent = {
  id: string;
  type?: string;
  summary?: string;
  targetType?: string;
  targetId?: string;
  createdAt?: string;
};

type ControlPlaneEventsResponse = {
  events?: ControlPlaneEvent[];
  error?: string;
};

type WorkspaceContextResponse = {
  context?: {
    identity: {
      userId: string;
      workspaceId: string;
      agentId: string;
      authMode: string;
      workspaceSource: string;
    };
    user: {
      id: string;
      email: string | null;
      displayName: string | null;
      status: string;
    } | null;
    workspace: {
      id: string;
      name: string;
      status: string;
    } | null;
    membership: {
      role: string;
      status: string;
      roles: string[];
      permissions: string[];
    } | null;
    agent: {
      id: string;
      name: string;
      status: string;
      isDefault: boolean;
    } | null;
  };
  error?: string;
};

const workspaceContextPath = "/api/workbench/context";
const cloudflareDemoRunsPath = "/api/workbench/cloudflare-demo-runs";
const cloudflareLatestDemoRunPath = "/api/workbench/cloudflare-demo-runs/latest";
const cloudflareControlEventsPath = "/api/workbench/control-events/latest";
const cloudflareControlEventStreamPath = "/api/workbench/control-events/stream";
const terminalStatuses = new Set(["completed", "failed", "cancelled"]);

const statusTone = (status?: string) => {
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

const formatTime = (value?: string) => {
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

export function WorkbenchShell() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [context, setContext] = useState<WorkspaceContextResponse["context"] | null>(null);
  const [snapshot, setSnapshot] = useState<WorkbenchDisplaySnapshot | null>(null);
  const [controlEvents, setControlEvents] = useState<ControlPlaneEvent[]>([]);
  const [isStarting, setIsStarting] = useState(false);
  const [isLoadingContext, setIsLoadingContext] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eventError, setEventError] = useState<string | null>(null);
  const latestControlEventIdRef = useRef<string | null>(null);

  const run = snapshot?.run;
  const isDemoActive = run?.status ? !terminalStatuses.has(run.status) : false;
  const latestToolCall = snapshot?.toolCalls.at(-1);
  const latestArtifact = snapshot?.artifacts.at(-1);
  const latestDecision = snapshot?.decisions.at(-1);
  const auditEvents = useMemo(() => snapshot?.auditEvents ?? [], [snapshot]);
  const latestChatEvent = useMemo(
    () => controlEvents.find((event) => event.type?.startsWith("chat.")),
    [controlEvents],
  );

  const readDemoRunResponse = async (response: Response, fallback: string) => {
    const body = (await response.json().catch(() => ({}))) as DemoRunResponse;
    if (!response.ok) throw new Error(body.error ?? fallback);
    return body;
  };

  const readControlEventsResponse = async (response: Response) => {
    const body = (await response.json().catch(() => ({}))) as ControlPlaneEventsResponse;
    if (!response.ok) throw new Error(body.error ?? "Failed to load Cloudflare activity");
    return body;
  };

  const readWorkspaceContextResponse = async (response: Response) => {
    const body = (await response.json().catch(() => ({}))) as WorkspaceContextResponse;
    if (!response.ok) throw new Error(body.error ?? "Failed to load workspace context");
    return body;
  };

  const mergeControlEvents = (events: ControlPlaneEvent[]) => {
    setControlEvents((current) => {
      const byId = new Map<string, ControlPlaneEvent>();
      for (const event of [...events, ...current]) byId.set(event.id, event);
      const merged = [...byId.values()]
        .sort((left, right) => {
          const rightTime = right.createdAt ? Date.parse(right.createdAt) : 0;
          const leftTime = left.createdAt ? Date.parse(left.createdAt) : 0;
          return rightTime - leftTime || right.id.localeCompare(left.id);
        })
        .slice(0, 30);
      latestControlEventIdRef.current = merged[0]?.id ?? null;
      return merged;
    });
  };

  const loadContext = async () => {
    setIsLoadingContext(true);
    try {
      const response = await fetch(workspaceContextPath, { cache: "no-store" });
      const body = await readWorkspaceContextResponse(response);
      setContext(body.context ?? null);
      setError(null);
    } finally {
      setIsLoadingContext(false);
    }
  };

  const loadLatest = async () => {
    const response = await fetch(cloudflareLatestDemoRunPath, {
      cache: "no-store",
    });
    const body = await readDemoRunResponse(response, "Failed to load Cloudflare demo run");
    setSnapshot(body.snapshot);
  };

  const loadControlEvents = async () => {
    const response = await fetch(cloudflareControlEventsPath, {
      cache: "no-store",
    });
    const body = await readControlEventsResponse(response);
    mergeControlEvents(body.events ?? []);
    setEventError(null);
  };

  useEffect(() => {
    if (!drawerOpen) return;
    void loadContext().catch((loadError: unknown) => {
      setError(loadError instanceof Error ? loadError.message : "Failed to load workspace context");
    });
    void loadLatest().catch((loadError: unknown) => {
      setError(loadError instanceof Error ? loadError.message : "Failed to load demo run");
    });
  }, [drawerOpen]);

  useEffect(() => {
    if (!isDemoActive) return;
    const interval = window.setInterval(() => {
      void loadLatest().catch((loadError: unknown) => {
        setError(
          loadError instanceof Error ? loadError.message : "Failed to poll Cloudflare demo run",
        );
      });
    }, 500);
    return () => window.clearInterval(interval);
  }, [isDemoActive]);

  useEffect(() => {
    if (!drawerOpen) return;

    let source: EventSource | null = null;
    let fallbackInterval: number | undefined;
    let cancelled = false;

    const startFallbackPolling = () => {
      if (fallbackInterval) return;
      fallbackInterval = window.setInterval(() => {
        void loadControlEvents().catch((loadError: unknown) => {
          setEventError(
            loadError instanceof Error ? loadError.message : "Failed to poll Cloudflare activity",
          );
        });
      }, 2500);
    };

    const startStream = async () => {
      try {
        await loadControlEvents();
      } catch (loadError) {
        setEventError(
          loadError instanceof Error ? loadError.message : "Failed to load Cloudflare activity",
        );
      }

      if (cancelled) return;

      if (!("EventSource" in window)) {
        startFallbackPolling();
        return;
      }

      const streamUrl = new URL(cloudflareControlEventStreamPath, window.location.origin);
      if (latestControlEventIdRef.current) {
        streamUrl.searchParams.set("after", latestControlEventIdRef.current);
      }

      source = new EventSource(streamUrl.toString());
      source.addEventListener("control-plane-event", (event) => {
        try {
          const parsed = JSON.parse(event.data) as ControlPlaneEvent;
          mergeControlEvents([parsed]);
          setEventError(null);
        } catch {
          setEventError("Cloudflare activity stream returned an invalid event");
        }
      });
      source.addEventListener("control-plane-error", (event) => {
        setEventError(event.data || "Cloudflare activity stream failed");
      });
      source.onerror = () => {
        setEventError("Cloudflare activity stream reconnecting");
      };
    };

    void startStream();

    return () => {
      cancelled = true;
      source?.close();
      if (fallbackInterval) window.clearInterval(fallbackInterval);
    };
  }, [drawerOpen]);

  const startDemoRun = async () => {
    setIsStarting(true);
    setError(null);
    try {
      const response = await fetch(cloudflareDemoRunsPath, {
        method: "POST",
      });
      const body = await readDemoRunResponse(response, "Failed to start Cloudflare demo run");
      setSnapshot(body.snapshot);
      void loadControlEvents().catch(() => undefined);
    } catch (startError) {
      setError(
        startError instanceof Error ? startError.message : "Failed to start Cloudflare demo run",
      );
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <div className="bg-background relative h-dvh overflow-hidden">
      <div className="absolute top-3 right-3 z-20 flex items-center gap-2">
        <AuthButton />
        <Dialog open={drawerOpen} onOpenChange={setDrawerOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="bg-background/95 shadow-xs">
              <PanelRightOpenIcon className="size-4" />
              Dev Monitor
            </Button>
          </DialogTrigger>
          <DialogContent
            className="top-0 right-0 left-auto h-dvh max-h-dvh w-[min(100vw,30rem)] max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none border-y-0 border-r-0 p-0 sm:max-w-none"
            aria-describedby="dev-monitor-description"
          >
            <DialogHeader className="border-border border-b px-5 py-4">
              <DialogTitle className="flex items-center gap-2 text-base">
                <PanelRightOpenIcon className="text-muted-foreground size-4" />
                Dev Monitor
              </DialogTitle>
              <DialogDescription id="dev-monitor-description">
                Cloudflare, Fly, WorkOS, and demo.inspect runtime state.
              </DialogDescription>
            </DialogHeader>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
              <MonitorSection icon={UserIcon} title="Identity">
                <StatusRow
                  label="Auth"
                  value={context?.identity.authMode ?? (isLoadingContext ? "loading" : "unknown")}
                />
                <StatusRow
                  label="Workspace source"
                  value={context?.identity.workspaceSource ?? "unknown"}
                />
                <StatusRow
                  label="User"
                  value={context?.user?.email ?? context?.user?.displayName}
                />
                <StatusRow
                  label="Membership"
                  value={
                    context?.membership
                      ? `${context.membership.role} / ${context.membership.status}`
                      : undefined
                  }
                />
                <CopyId label="User id" value={context?.identity.userId} />
                <CopyId label="Workspace id" value={context?.identity.workspaceId} />
                <CopyId label="Agent id" value={context?.identity.agentId} />
              </MonitorSection>

              <MonitorSection icon={MessageSquareIcon} title="Chat Path">
                <StatusRow label="Browser route" value="/api/*" />
                <StatusRow label="Control plane" value="Cloudflare /langgraph" />
                <StatusRow label="Executor" value="Fly LangGraph runtime" />
                <StatusRow
                  label="Latest chat event"
                  value={latestChatEvent?.type ?? "no chat event loaded"}
                  tone={latestChatEvent ? "ok" : "muted"}
                />
                <p className="text-muted-foreground text-xs">
                  Chat status is separate from demo.inspect. It is inferred from recent Cloudflare
                  chat events.
                </p>
              </MonitorSection>

              <MonitorSection icon={WrenchIcon} title="Demo Inspect Path">
                <div className="flex items-center justify-between gap-3">
                  <StatusPill status={`demo run: ${run?.status ?? "idle"}`} tone={run?.status} />
                  <Button size="sm" onClick={startDemoRun} disabled={isStarting || isDemoActive}>
                    {isStarting ? <Loader2Icon className="animate-spin" /> : <PlayIcon />}
                    Run diagnostic
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <StatusRow label="Mode" value={run?.execution?.mode ?? "dry_run"} compact />
                  <StatusRow label="Stage" value={run?.stage ?? "observe"} compact />
                  <StatusRow
                    label="Intent"
                    value={snapshot?.intent?.type ?? "not created"}
                    compact
                  />
                  <StatusRow label="Updated" value={formatTime(run?.updatedAt)} compact />
                </div>
                <CopyId label="Run id" value={run?.id} />
                <RuntimeRecord
                  icon={WrenchIcon}
                  label="Tool call"
                  title={latestToolCall?.toolId ?? "none yet"}
                  detail={latestToolCall?.outputSummary ?? latestToolCall?.inputSummary}
                  status={latestToolCall?.status}
                />
                <RuntimeRecord
                  icon={FileTextIcon}
                  label="Artifact"
                  title={latestArtifact?.title ?? "none yet"}
                  detail={latestArtifact?.uri}
                />
                <RuntimeRecord
                  icon={ShieldCheckIcon}
                  label="Decision"
                  title={latestDecision?.title ?? "none yet"}
                  detail={latestDecision?.summary}
                />
              </MonitorSection>

              <MonitorSection icon={ActivityIcon} title="Cloudflare Events">
                {eventError ? <p className="text-destructive text-sm">{eventError}</p> : null}
                {controlEvents.length > 0 ? (
                  <ol className="space-y-3">
                    {controlEvents.slice(0, 10).map((event) => (
                      <li key={event.id} className="grid grid-cols-[0.75rem_1fr] gap-3 text-sm">
                        <span className="bg-primary mt-1.5 size-2 rounded-full" />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">
                            {event.type ?? "control.event"}
                          </span>
                          <span className="text-muted-foreground block">
                            {event.summary ?? "Control-plane event recorded."}
                          </span>
                          <span className="text-muted-foreground/80 block truncate text-xs">
                            {formatTime(event.createdAt)}
                            {event.targetType ? ` / ${event.targetType}` : ""}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <EmptyPanelText>
                    Open chat or run the diagnostic to populate events.
                  </EmptyPanelText>
                )}
              </MonitorSection>

              <MonitorSection icon={HistoryIcon} title="Audit Trail">
                {auditEvents.length > 0 ? (
                  <ol className="space-y-3">
                    {auditEvents.map((event) => (
                      <li key={event.id} className="grid grid-cols-[0.75rem_1fr] gap-3 text-sm">
                        <span className="bg-muted-foreground mt-1.5 size-2 rounded-full" />
                        <span>
                          <span className="block font-medium">{event.action ?? "audit.event"}</span>
                          <span className="text-muted-foreground block">
                            {event.summary ?? "Audit summary is pending."}
                          </span>
                          <span className="text-muted-foreground/80 block text-xs">
                            {formatTime(event.createdAt)}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <EmptyPanelText>
                    Demo audit events appear after the diagnostic starts.
                  </EmptyPanelText>
                )}
              </MonitorSection>

              <MonitorSection icon={AlertCircleIcon} title="Last Error">
                {error ? (
                  <p className="text-destructive text-sm">{error}</p>
                ) : (
                  <EmptyPanelText>
                    No workbench error recorded in this browser session.
                  </EmptyPanelText>
                )}
              </MonitorSection>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Assistant />
    </div>
  );
}

function MonitorSection({
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

function StatusRow({
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

function StatusPill({ status, tone }: { status: string; tone?: string }) {
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

function CopyId({ label, value }: { label: string; value?: string | null }) {
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

function RuntimeRecord({
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

function EmptyPanelText({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground text-sm">{children}</p>;
}
