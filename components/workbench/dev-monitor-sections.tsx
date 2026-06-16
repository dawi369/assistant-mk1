"use client";

import type { ReactNode } from "react";
import { ActivityIcon, ChevronDownIcon } from "lucide-react";

import {
  EmptyPanelText,
  formatTime,
  MonitorSection,
  StatusPill,
  StatusRow,
} from "@/components/workbench/dev-monitor-primitives";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { RuntimeSpan, RuntimeTrace } from "@/lib/workbench/workbench-types";

export const formatDuration = (value?: number | null) => {
  if (typeof value !== "number" || Number.isNaN(value)) return undefined;
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}s`;
};

export const formatAge = (value?: string) => {
  if (!value) return "Pending";
  const ageMs = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) return formatTime(value);
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

export const approvalTone = (status?: string) => {
  if (status === "requested") return "running";
  if (status === "approved" || status === "denied") return "completed";
  if (status === "failed") return "failed";
  return undefined;
};

export function DetailsBlock({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="border-border rounded-md border">
      <CollapsibleTrigger className="hover:bg-muted/60 flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium">
        {title}
        <ChevronDownIcon className="text-muted-foreground size-4" />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 border-t px-3 py-3">{children}</CollapsibleContent>
    </Collapsible>
  );
}

const serviceNodes: Array<{ layer: RuntimeSpan["layer"]; label: string }> = [
  { layer: "browser", label: "Browser" },
  { layer: "vercel", label: "Vercel" },
  { layer: "cloudflare", label: "Cloudflare Agent" },
  { layer: "durable_object", label: "Durable Object" },
  { layer: "d1", label: "D1" },
  { layer: "provider", label: "OpenRouter" },
  { layer: "executor", label: "Executor" },
  { layer: "tool", label: "Tool" },
];

const traceTone = (status?: RuntimeTrace["status"] | RuntimeSpan["status"]) => {
  if (status === "completed") return "completed";
  if (status === "failed" || status === "blocked") return "failed";
  if (status === "running") return "running";
  return undefined;
};

const sortSpans = (spans: RuntimeSpan[]) =>
  [...spans].sort((left, right) => {
    const leftTime = left.startedAt ? Date.parse(left.startedAt) : 0;
    const rightTime = right.startedAt ? Date.parse(right.startedAt) : 0;
    return leftTime - rightTime;
  });

const occupiedDuration = (spans: RuntimeSpan[]) => {
  const intervals = spans
    .map((span) => {
      const start = span.offsetMs ?? 0;
      const end = start + (span.durationMs ?? 0);
      return end > start ? { start, end } : null;
    })
    .filter((interval): interval is { start: number; end: number } => Boolean(interval))
    .sort((left, right) => left.start - right.start);

  let total = 0;
  let current: { start: number; end: number } | null = null;
  for (const interval of intervals) {
    if (!current) {
      current = { ...interval };
      continue;
    }
    if (interval.start <= current.end) {
      current.end = Math.max(current.end, interval.end);
      continue;
    }
    total += current.end - current.start;
    current = { ...interval };
  }
  if (current) total += current.end - current.start;
  return total;
};

export function LiveRequestMap({
  trace,
  spans,
}: {
  trace?: RuntimeTrace | null;
  spans: RuntimeSpan[];
}) {
  const sortedSpans = sortSpans(spans);
  const operationSpans = sortedSpans.filter((span) => span.bottleneckCandidate !== false);
  const phaseSpans = sortedSpans.filter(
    (span) => span.spanType === "phase" || span.isAggregate === true,
  );
  const bottleneck =
    operationSpans.find((span) => span.spanId === trace?.bottleneckSpanId) ??
    operationSpans
      .filter((span) => typeof span.durationMs === "number")
      .sort((left, right) => (right.durationMs ?? 0) - (left.durationMs ?? 0))[0];
  const runningSpan = sortedSpans.find((span) => span.status === "running");
  const activeLayer = runningSpan?.layer ?? bottleneck?.layer ?? sortedSpans.at(-1)?.layer;
  const maxTimeline = Math.max(
    1,
    trace?.durationMs ?? 0,
    ...sortedSpans.map((span) => (span.offsetMs ?? 0) + (span.durationMs ?? 0)),
  );
  const providerFirstToken = sortedSpans.find((span) => span.name === "OpenRouter first token");
  const streamDuration = sortedSpans.find((span) => span.name === "Stream duration");
  const postStream = sortedSpans.find((span) => span.name === "Post-stream D1 writes");
  const mirrorWrites = sortedSpans.find((span) => span.name === "Mirror chat run records");
  const phaseSummary = [
    [
      "Pre-stream",
      phaseSpans.find((span) => span.name === "Pre-stream total")?.durationMs ??
        mirrorWrites?.durationMs,
    ],
    ["First token", providerFirstToken?.durationMs],
    ["Stream", streamDuration?.durationMs],
    ["Post-stream", postStream?.durationMs ?? mirrorWrites?.durationMs],
    ["Total", trace?.durationMs],
  ] as const;

  return (
    <MonitorSection icon={ActivityIcon} title="Live Request Map">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={trace?.status ?? "no trace yet"} tone={traceTone(trace?.status)} />
            <span className="text-sm font-medium">{trace?.rootName ?? "No request selected"}</span>
          </div>
          <p className="text-muted-foreground mt-1 text-xs">
            {trace?.summary ??
              "Send a message, create a thread, or run a tool to populate the trace graph."}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-right text-xs">
          <StatusRow label="Total" value={formatDuration(trace?.durationMs)} compact />
          <StatusRow
            label={trace?.bottleneckConfidence === "fallback" ? "Bottleneck*" : "Bottleneck"}
            value={bottleneck?.name ?? "none"}
            compact
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        {phaseSummary.map(([label, value]) => (
          <div key={label} className="border-border rounded-md border p-3 text-sm">
            <p className="text-muted-foreground text-xs">{label}</p>
            <p className="mt-1 font-medium">{formatDuration(value) ?? "-"}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
        {serviceNodes.map((node) => {
          const nodeAllSpans = sortedSpans.filter((span) => span.layer === node.layer);
          const nodeSpans = nodeAllSpans.filter((span) => !span.isAggregate);
          const failed = nodeAllSpans.some(
            (span) => span.status === "failed" || span.status === "blocked",
          );
          const completed = nodeSpans.some((span) => span.status === "completed");
          const active = activeLayer === node.layer;
          const totalMs = occupiedDuration(nodeSpans);
          return (
            <div
              key={node.layer}
              className={[
                "border-border bg-background rounded-md border p-3 text-sm",
                active ? "ring-ring ring-2" : "",
                failed ? "border-destructive/40 bg-destructive/10" : "",
              ].join(" ")}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{node.label}</span>
                <span
                  className={[
                    "size-2 rounded-full",
                    failed
                      ? "bg-destructive"
                      : active
                        ? "bg-primary"
                        : completed
                          ? "bg-emerald-500"
                          : "bg-muted-foreground/30",
                  ].join(" ")}
                />
              </div>
              <p className="text-muted-foreground mt-1 text-xs">
                {nodeSpans.length
                  ? `${nodeSpans.length} spans / ${formatDuration(totalMs)} occupied`
                  : "idle"}
              </p>
            </div>
          );
        })}
      </div>

      <div className="space-y-2">
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs font-medium">Waterfall</p>
          <p className="text-muted-foreground text-xs">
            Phase rows summarize overlapping work and are excluded from bottleneck ranking.
          </p>
          {trace?.bottleneckReason ? (
            <p className="text-muted-foreground text-xs">{trace.bottleneckReason}</p>
          ) : null}
        </div>
        {sortedSpans.length ? (
          sortedSpans.map((span) => (
            <div
              key={span.spanId}
              className="grid grid-cols-[9rem_1fr_5.5rem] items-center gap-2 text-xs"
            >
              <span className="text-muted-foreground truncate">{span.layer}</span>
              <div className="min-w-0">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="truncate font-medium">
                    {span.name}
                    {span.isAggregate ? (
                      <span className="text-muted-foreground ml-1 font-normal">(phase)</span>
                    ) : null}
                  </span>
                  <StatusPill status={span.status} tone={traceTone(span.status)} />
                </div>
                <div className="bg-muted relative h-1.5 overflow-hidden rounded-full">
                  <div
                    className={[
                      "absolute h-full rounded-full",
                      span.isAggregate ? "bg-muted-foreground/50" : "bg-primary",
                    ].join(" ")}
                    style={{
                      left: `${Math.min(100, ((span.offsetMs ?? 0) / maxTimeline) * 100)}%`,
                      width: `${Math.max(2, ((span.durationMs ?? 0) / maxTimeline) * 100)}%`,
                    }}
                  />
                </div>
              </div>
              <span className="text-muted-foreground text-right">
                {formatDuration(span.durationMs) ?? "-"}
                {typeof span.offsetMs === "number" ? ` @ ${formatDuration(span.offsetMs)}` : ""}
              </span>
            </div>
          ))
        ) : (
          <EmptyPanelText>No trace spans recorded yet.</EmptyPanelText>
        )}
      </div>
    </MonitorSection>
  );
}
