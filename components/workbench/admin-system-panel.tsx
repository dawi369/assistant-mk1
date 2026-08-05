"use client";

import { ChevronDownIcon, FileClockIcon, Loader2Icon, PlayIcon, WrenchIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CopyId, EmptyPanelText, StatusPill } from "@/components/workbench/dev-monitor-primitives";
import type { CloudflareAdminSummaryResponse } from "@/lib/workbench/workbench-types";

const inputClass =
  "border-input bg-background h-9 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function AdminSystemPanel({
  summary,
  busyTool,
  urlTarget,
  onUrlTargetChange,
  onRunDiagnostic,
}: {
  summary?: CloudflareAdminSummaryResponse["summary"] | null;
  busyTool: string | null;
  urlTarget: string;
  onUrlTargetChange: (value: string) => void;
  onRunDiagnostic: (toolName: string, input?: Record<string, unknown>) => Promise<void>;
}) {
  return (
    <div className="space-y-4">
      <section className="border-border bg-background rounded-lg border">
        <div className="border-border flex items-center gap-2 border-b px-4 py-3">
          <FileClockIcon className="text-muted-foreground size-4" />
          <div>
            <h2 className="text-sm font-semibold">Recent runtime</h2>
            <p className="text-muted-foreground mt-0.5 text-xs">
              The latest system activity and failures.
            </p>
          </div>
        </div>
        <div className="divide-border divide-y">
          {(summary?.recentTraces ?? []).slice(0, 5).map((trace) => (
            <div key={trace.traceId} className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{trace.rootName}</p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {trace.summary ?? `${trace.durationMs ?? 0}ms`}
                </p>
              </div>
              <StatusPill status={trace.status} tone={trace.status} />
            </div>
          ))}
          {!summary?.recentTraces?.length ? (
            <div className="p-4">
              <EmptyPanelText>No recent runtime activity.</EmptyPanelText>
            </div>
          ) : null}
        </div>
      </section>

      <details className="group border-border bg-background rounded-lg border">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 marker:hidden">
          <span className="flex items-center gap-2">
            <WrenchIcon className="text-muted-foreground size-4" />
            <span>
              <span className="block text-sm font-semibold">Run system checks</span>
              <span className="text-muted-foreground mt-0.5 block text-xs">
                Operator diagnostics for the control plane and runner.
              </span>
            </span>
          </span>
          <ChevronDownIcon className="text-muted-foreground size-4 transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-border border-t p-4">
          <div className="grid gap-2 sm:grid-cols-3">
            {["diagnostic.ping", "runner.echo", "artifact.metadata.test"].map((toolName) => (
              <Button
                key={toolName}
                variant="outline"
                size="sm"
                disabled={Boolean(busyTool)}
                onClick={() =>
                  void onRunDiagnostic(
                    toolName,
                    toolName === "runner.echo"
                      ? { message: "runner echo ok" }
                      : toolName === "artifact.metadata.test"
                        ? { label: "admin conformance" }
                        : {},
                  )
                }
              >
                {busyTool === toolName ? <Loader2Icon className="animate-spin" /> : <PlayIcon />}
                {toolName}
              </Button>
            ))}
          </div>
          <form
            className="mt-4 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (urlTarget.trim()) void onRunDiagnostic("url.inspect", { url: urlTarget.trim() });
            }}
          >
            <input
              className={inputClass}
              value={urlTarget}
              onChange={(event) => onUrlTargetChange(event.target.value)}
              placeholder="https://example.com"
              aria-label="URL to inspect"
            />
            <Button
              type="submit"
              variant="outline"
              disabled={!urlTarget.trim() || Boolean(busyTool)}
            >
              Inspect
            </Button>
          </form>
        </div>
      </details>

      <details className="group border-border bg-background rounded-lg border">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 marker:hidden">
          <span>
            <span className="block text-sm font-semibold">Advanced</span>
            <span className="text-muted-foreground mt-0.5 block text-xs">
              Runtime identifiers and raw diagnostic context.
            </span>
          </span>
          <ChevronDownIcon className="text-muted-foreground size-4 transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-border border-t p-4">
          <div className="grid gap-3 md:grid-cols-3">
            <CopyId label="User id" value={summary?.identity.userId} />
            <CopyId label="Workspace id" value={summary?.identity.workspaceId} />
            <CopyId label="Agent id" value={summary?.identity.agentId} />
          </div>
          <details className="mt-4">
            <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-xs">
              Summary JSON
            </summary>
            <pre className="bg-muted mt-2 max-h-80 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
              {JSON.stringify(summary ?? {}, null, 2)}
            </pre>
          </details>
        </div>
      </details>
    </div>
  );
}
