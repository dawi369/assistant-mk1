"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ActivityIcon,
  FileTextIcon,
  HistoryIcon,
  Loader2Icon,
  type LucideIcon,
  PlayIcon,
  ShieldCheckIcon,
  WrenchIcon,
} from "lucide-react";

import { Assistant } from "@/app/assistant";
import { AuthButton } from "@/components/auth/auth-button";
import { Button } from "@/components/ui/button";
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

export function WorkbenchShell() {
  const [snapshot, setSnapshot] = useState<WorkbenchDisplaySnapshot | null>(null);
  const [controlEvents, setControlEvents] = useState<ControlPlaneEvent[]>([]);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eventError, setEventError] = useState<string | null>(null);
  const latestControlEventIdRef = useRef<string | null>(null);

  const run = snapshot?.run;
  const isActive = run?.status ? !terminalStatuses.has(run.status) : false;

  const latestToolCall = snapshot?.toolCalls.at(-1);
  const latestArtifact = snapshot?.artifacts.at(-1);
  const latestDecision = snapshot?.decisions.at(-1);
  const auditEvents = useMemo(() => snapshot?.auditEvents ?? [], [snapshot]);

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
        .slice(0, 25);
      latestControlEventIdRef.current = merged[0]?.id ?? null;
      return merged;
    });
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
    void loadLatest().catch((loadError: unknown) => {
      setError(loadError instanceof Error ? loadError.message : "Failed to load demo run");
    });
  }, []);

  useEffect(() => {
    if (!isActive) return;
    const interval = window.setInterval(() => {
      void loadLatest().catch((loadError: unknown) => {
        setError(
          loadError instanceof Error ? loadError.message : "Failed to poll Cloudflare demo run",
        );
      });
    }, 350);
    return () => window.clearInterval(interval);
  }, [isActive]);

  useEffect(() => {
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
  }, []);

  const startDemoRun = async () => {
    setIsStarting(true);
    setError(null);
    try {
      const response = await fetch(cloudflareDemoRunsPath, {
        method: "POST",
      });
      const body = await readDemoRunResponse(response, "Failed to start Cloudflare demo run");
      setSnapshot(body.snapshot);
    } catch (startError) {
      setError(
        startError instanceof Error ? startError.message : "Failed to start Cloudflare demo run",
      );
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <div className="bg-background grid h-dvh grid-rows-[auto_1fr] overflow-hidden lg:grid-cols-[minmax(0,1fr)_25rem] lg:grid-rows-1">
      <section className="border-border/80 bg-background flex min-h-0 flex-col border-b lg:border-r lg:border-b-0">
        <WorkbenchStatusStrip
          snapshot={snapshot}
          isStarting={isStarting}
          onStart={startDemoRun}
          error={error}
        />
        <div className="min-h-0 flex-1">
          <Assistant />
        </div>
      </section>

      <aside className="bg-muted/20 min-h-0 overflow-y-auto">
        <div className="flex flex-col gap-4 p-4">
          <PanelTitle
            icon={ActivityIcon}
            title="Run Snapshot"
            detail={run ? `Updated ${formatTime(run.updatedAt)}` : "No demo run yet"}
          />

          <WorkbenchPanel>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Metric label="Status" value={run?.status ?? "idle"} tone={statusTone(run?.status)} />
              <Metric label="Mode" value={run?.execution?.mode ?? "dry_run"} />
              <Metric label="Intent" value={snapshot?.intent?.type ?? "not created"} />
              <Metric label="Stage" value={run?.stage ?? "observe"} />
            </div>
          </WorkbenchPanel>

          <WorkbenchPanel>
            <PanelSection icon={ActivityIcon} title="Cloudflare Activity" />
            {controlEvents.length > 0 ? (
              <ol className="mt-3 space-y-3">
                {controlEvents.slice(0, 8).map((event) => (
                  <li key={event.id} className="grid grid-cols-[0.75rem_1fr] gap-3 text-sm">
                    <span className="bg-sky-500 mt-1.5 size-2 rounded-full" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {event.type ?? "control.event"}
                      </span>
                      <span className="text-muted-foreground block">
                        {event.summary ?? "Control-plane event recorded."}
                      </span>
                      <span className="text-muted-foreground/80 block truncate text-xs">
                        {formatTime(event.createdAt)}
                        {event.targetType ? ` · ${event.targetType}` : ""}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyPanelText>
                {eventError ?? "Cloudflare activity will appear after chat or run progress."}
              </EmptyPanelText>
            )}
          </WorkbenchPanel>

          <WorkbenchPanel>
            <PanelSection icon={WrenchIcon} title="Tool Call" />
            {latestToolCall ? (
              <div className="mt-3 space-y-2 text-sm">
                <p className="font-medium">{latestToolCall.toolId ?? "demo.inspect"}</p>
                <p className="text-muted-foreground">
                  {latestToolCall.outputSummary ??
                    latestToolCall.inputSummary ??
                    "Tool call summary is pending."}
                </p>
                <span
                  className={cn(
                    "inline-flex rounded-md border px-2 py-1 text-xs font-medium",
                    statusTone(latestToolCall.status),
                  )}
                >
                  {latestToolCall.status}
                </span>
              </div>
            ) : (
              <EmptyPanelText>Tool call will appear after the demo run starts.</EmptyPanelText>
            )}
          </WorkbenchPanel>

          <WorkbenchPanel>
            <PanelSection icon={FileTextIcon} title="Artifact" />
            {latestArtifact ? (
              <div className="mt-3 space-y-2 text-sm">
                <p className="font-medium">{latestArtifact.title ?? "Artifact"}</p>
                <p className="text-muted-foreground font-mono text-xs">
                  {latestArtifact.uri ?? "Artifact URI pending"}
                </p>
                <p className="text-muted-foreground">
                  {latestArtifact.mimeType ?? "application/octet-stream"}
                </p>
              </div>
            ) : (
              <EmptyPanelText>
                Artifact metadata will appear after the tool finishes.
              </EmptyPanelText>
            )}
          </WorkbenchPanel>

          <WorkbenchPanel>
            <PanelSection icon={ShieldCheckIcon} title="Decision" />
            {latestDecision ? (
              <div className="mt-3 space-y-2 text-sm">
                <p className="font-medium">{latestDecision.title ?? "Decision"}</p>
                <p className="text-muted-foreground">
                  {latestDecision.summary ?? "Decision summary is pending."}
                </p>
                <p className="text-muted-foreground border-border border-l pl-3 text-xs">
                  {latestDecision.thesis ?? "Decision thesis is pending."}
                </p>
              </div>
            ) : (
              <EmptyPanelText>
                Decision record will appear when durable outputs are complete.
              </EmptyPanelText>
            )}
          </WorkbenchPanel>

          <WorkbenchPanel>
            <PanelSection icon={HistoryIcon} title="Audit Timeline" />
            {auditEvents.length > 0 ? (
              <ol className="mt-3 space-y-3">
                {auditEvents.map((event) => (
                  <li key={event.id} className="grid grid-cols-[0.75rem_1fr] gap-3 text-sm">
                    <span className="bg-primary mt-1.5 size-2 rounded-full" />
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
              <EmptyPanelText>Audit events will appear as the run progresses.</EmptyPanelText>
            )}
          </WorkbenchPanel>
        </div>
      </aside>
    </div>
  );
}

function WorkbenchStatusStrip({
  snapshot,
  isStarting,
  onStart,
  error,
}: {
  snapshot: WorkbenchDisplaySnapshot | null;
  isStarting: boolean;
  onStart: () => void;
  error: string | null;
}) {
  const status = snapshot?.run?.status ?? "idle";
  const isActive = snapshot?.run?.status ? !terminalStatuses.has(snapshot.run.status) : false;

  return (
    <div className="border-border/80 bg-background/95 flex flex-col gap-3 border-b px-4 py-3 md:flex-row md:items-center md:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={cn(
            "inline-flex rounded-md border px-2.5 py-1 text-xs font-medium",
            statusTone(status),
          )}
        >
          {isActive ? <Loader2Icon className="mr-1 size-3 animate-spin" /> : null}
          {status}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">Assistant-MK1 Workbench</p>
          <p className="text-muted-foreground truncate text-xs">
            {snapshot?.intent?.type
              ? `Cloudflare-owned ${snapshot.intent.type}`
              : "Run the Cloudflare-owned demo inspect slice"}
            {error ? ` - ${error}` : ""}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <AuthButton />
        <Button size="sm" onClick={onStart} disabled={isStarting || isActive}>
          {isStarting ? <Loader2Icon className="animate-spin" /> : <PlayIcon />}
          Run demo inspect
        </Button>
      </div>
    </div>
  );
}

function WorkbenchPanel({ children }: { children: ReactNode }) {
  return (
    <section className="border-border bg-background rounded-lg border p-4 shadow-xs">
      {children}
    </section>
  );
}

function PanelTitle({
  icon: Icon,
  title,
  detail,
}: {
  icon: LucideIcon;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="border-border bg-background inline-flex size-9 items-center justify-center rounded-lg border">
        <Icon className="text-muted-foreground size-4" />
      </span>
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-muted-foreground text-xs">{detail}</p>
      </div>
    </div>
  );
}

function PanelSection({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="text-muted-foreground size-4" />
      <h3 className="text-sm font-semibold">{title}</h3>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p
        className={cn(
          "mt-1 truncate rounded-md border px-2 py-1 text-xs font-medium",
          tone ?? "border-border",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function EmptyPanelText({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground mt-3 text-sm">{children}</p>;
}
