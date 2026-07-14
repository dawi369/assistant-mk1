"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BellRingIcon,
  CheckCircle2Icon,
  Clock3Icon,
  CopyIcon,
  ExternalLinkIcon,
  Loader2Icon,
  PauseIcon,
  PlayIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  ShieldAlertIcon,
  SquareIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  EmptyPanelText,
  formatTime,
  StatusPill,
} from "@/components/workbench/dev-monitor-primitives";
import type {
  AgentPackTemplateMetadata,
  CloudflareOperatorAlertsResponse,
  CloudflareTriggerDispatchesResponse,
  CloudflareTriggersResponse,
  OperatorAlertSummary,
  TriggerDispatchSummary,
  TriggerSummary,
} from "@/lib/workbench/workbench-types";
import { canReplayDispatch, configuredTriggerFor } from "@/lib/workbench/automations-surface";
import { readJsonResponse } from "@/lib/workbench/read-json-response";

const triggersPath = "/api/workbench/triggers";
const dispatchesPath = "/api/workbench/trigger-dispatches";
const operatorAlertsPath = "/api/workbench/operator-alerts";
const sectionClass = "border-border rounded-lg border bg-background";
const alertSeverityTone = (severity: OperatorAlertSummary["severity"]) =>
  severity === "critical" ? "failed" : "queued";
const alertDeliveryTone = (status: OperatorAlertSummary["deliveryStatus"]) =>
  status === "delivered" ? "completed" : status === "failed" ? "failed" : "queued";

type DeclaredTrigger = NonNullable<AgentPackTemplateMetadata["triggers"]>[number];

export function WorkbenchAutomationsPanel({
  open,
  pack,
  canManage,
  onOpenHistory,
}: {
  open: boolean;
  pack?: AgentPackTemplateMetadata | null;
  canManage: boolean;
  onOpenHistory: (runId: string) => void;
}) {
  const [triggers, setTriggers] = useState<TriggerSummary[]>([]);
  const [dispatches, setDispatches] = useState<TriggerDispatchSummary[]>([]);
  const [alerts, setAlerts] = useState<OperatorAlertSummary[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [webhookCredential, setWebhookCredential] = useState<{
    publicId?: string;
    secret: string;
  } | null>(null);
  const [inputDrafts, setInputDrafts] = useState<Record<string, string>>({});

  const declared = useMemo(() => pack?.triggers ?? [], [pack?.triggers]);

  const load = useCallback(async () => {
    if (!open || !pack) return;
    setLoading(true);
    try {
      const [triggerBody, dispatchBody, alertBody] = await Promise.all([
        readJsonResponse<CloudflareTriggersResponse>(
          await fetch(`${triggersPath}?limit=100`, { cache: "no-store" }),
          "Failed to load automations",
        ),
        readJsonResponse<CloudflareTriggerDispatchesResponse>(
          await fetch(`${dispatchesPath}?limit=10`, { cache: "no-store" }),
          "Failed to load automation activity",
        ),
        canManage
          ? readJsonResponse<CloudflareOperatorAlertsResponse>(
              await fetch(`${operatorAlertsPath}?limit=25`, { cache: "no-store" }),
              "Failed to load operator alerts",
            )
          : Promise.resolve({ alerts: [] } satisfies CloudflareOperatorAlertsResponse),
      ]);
      setTriggers(triggerBody.triggers ?? []);
      setDispatches(dispatchBody.dispatches ?? []);
      setAlerts(alertBody.alerts ?? []);
      setInputDrafts((current) => {
        const next = { ...current };
        for (const trigger of triggerBody.triggers ?? []) {
          if (!(trigger.id in next)) next[trigger.id] = JSON.stringify(trigger.input, null, 2);
        }
        return next;
      });
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load automations");
    } finally {
      setLoading(false);
    }
  }, [canManage, open, pack]);

  useEffect(() => {
    void load();
  }, [load]);

  const createTrigger = async (trigger: DeclaredTrigger) => {
    if (!pack) return;
    setBusyId(trigger.id);
    setError(null);
    try {
      const body = await readJsonResponse<CloudflareTriggersResponse & { webhookSecret?: string }>(
        await fetch(triggersPath, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ packId: pack.id, packTriggerId: trigger.id, status: "paused" }),
        }),
        "Failed to configure automation",
      );
      if (body.webhookSecret) {
        setWebhookCredential({
          publicId: (body.trigger as (TriggerSummary & { publicId?: string }) | undefined)
            ?.publicId,
          secret: body.webhookSecret,
        });
      }
      await load();
    } catch (createError) {
      setError(
        createError instanceof Error ? createError.message : "Failed to configure automation",
      );
    } finally {
      setBusyId(null);
    }
  };

  const updateStatus = async (trigger: TriggerSummary, status: TriggerSummary["status"]) => {
    if (status === "disabled" && !window.confirm("Disable this automation permanently?")) return;
    setBusyId(trigger.id);
    setError(null);
    try {
      await readJsonResponse<CloudflareTriggersResponse>(
        await fetch(`${triggersPath}/${encodeURIComponent(trigger.id)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ expectedVersion: trigger.version, status }),
        }),
        `Failed to ${status} automation`,
      );
      await load();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Failed to update automation");
    } finally {
      setBusyId(null);
    }
  };

  const runNow = async (trigger: TriggerSummary) => {
    setBusyId(trigger.id);
    setError(null);
    try {
      await readJsonResponse<CloudflareTriggerDispatchesResponse>(
        await fetch(`${triggersPath}/${encodeURIComponent(trigger.id)}/dispatches`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ idempotencyKey: `manual:${crypto.randomUUID()}`, payload: {} }),
        }),
        "Failed to dispatch automation",
      );
      await load();
      window.setTimeout(() => void load(), 1200);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Failed to dispatch automation");
    } finally {
      setBusyId(null);
    }
  };

  const saveInput = async (trigger: TriggerSummary) => {
    setBusyId(trigger.id);
    setError(null);
    try {
      const parsed = JSON.parse(inputDrafts[trigger.id] ?? "{}") as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Automation input must be a JSON object.");
      }
      await readJsonResponse<CloudflareTriggersResponse>(
        await fetch(`${triggersPath}/${encodeURIComponent(trigger.id)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ expectedVersion: trigger.version, input: parsed }),
        }),
        "Failed to save automation input",
      );
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save automation input");
    } finally {
      setBusyId(null);
    }
  };

  const replay = async (dispatch: TriggerDispatchSummary) => {
    setBusyId(dispatch.id);
    setError(null);
    try {
      await readJsonResponse<CloudflareTriggerDispatchesResponse>(
        await fetch(`${dispatchesPath}/${encodeURIComponent(dispatch.id)}/replay`, {
          method: "POST",
        }),
        "Failed to replay automation",
      );
      await load();
      window.setTimeout(() => void load(), 1200);
    } catch (replayError) {
      setError(replayError instanceof Error ? replayError.message : "Failed to replay automation");
    } finally {
      setBusyId(null);
    }
  };

  const updateAlert = async (alert: OperatorAlertSummary, status: "acknowledged" | "resolved") => {
    setBusyId(alert.id);
    setError(null);
    try {
      await readJsonResponse<CloudflareOperatorAlertsResponse>(
        await fetch(`${operatorAlertsPath}/${encodeURIComponent(alert.id)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status }),
        }),
        `Failed to mark alert ${status}`,
      );
      await load();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Failed to update alert");
    } finally {
      setBusyId(null);
    }
  };

  const retryAlertDelivery = async (alert: OperatorAlertSummary) => {
    setBusyId(alert.id);
    setError(null);
    try {
      await readJsonResponse<CloudflareOperatorAlertsResponse>(
        await fetch(`${operatorAlertsPath}/${encodeURIComponent(alert.id)}/retry-delivery`, {
          method: "POST",
        }),
        "Failed to retry alert delivery",
      );
      await load();
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : "Failed to retry alert delivery");
    } finally {
      setBusyId(null);
    }
  };

  if (!pack) return null;

  return (
    <section className={`${sectionClass} mt-5`}>
      <div className="border-border flex items-start justify-between gap-3 border-b px-4 py-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Clock3Icon className="text-muted-foreground size-4" />
            Automations
          </h2>
          <p className="text-muted-foreground mt-1 text-xs">
            Disabled-by-default schedules, monitors, and webhooks declared by the current pack.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
          Refresh
        </Button>
      </div>

      {error ? (
        <div className="border-destructive/30 bg-destructive/5 text-destructive border-b px-4 py-2 text-xs">
          {error}
        </div>
      ) : null}

      {webhookCredential ? (
        <div className="border-amber-300/50 bg-amber-50/60 border-b px-4 py-3 text-xs dark:bg-amber-950/20">
          <div className="flex items-start gap-2">
            <ShieldAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                Save this webhook secret now. It will not be shown again.
              </p>
              {webhookCredential.publicId ? (
                <p className="text-muted-foreground mt-1 break-all">
                  Endpoint: /api/external-signals/{webhookCredential.publicId}
                </p>
              ) : null}
              <code className="bg-background mt-2 block overflow-x-auto rounded border p-2">
                {webhookCredential.secret}
              </code>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void navigator.clipboard.writeText(webhookCredential.secret)}
            >
              <CopyIcon /> Copy
            </Button>
          </div>
        </div>
      ) : null}

      <div className="divide-border divide-y">
        {declared.map((declaration) => {
          const configured = configuredTriggerFor(declaration, triggers);
          const busy = busyId === (configured?.id ?? declaration.id);
          return (
            <div
              key={declaration.id}
              className="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium">{declaration.id}</p>
                  <StatusPill status={configured?.status ?? "Not configured"} />
                  <span className="text-muted-foreground text-xs">{declaration.kind}</span>
                </div>
                <p className="text-muted-foreground mt-1 text-xs">{declaration.description}</p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {declaration.workflowType}
                  {configured?.nextTriggerAt
                    ? ` · next ${formatTime(configured.nextTriggerAt)}`
                    : ""}
                  {configured?.lastTriggeredAt
                    ? ` · last ${formatTime(configured.lastTriggeredAt)}`
                    : ""}
                </p>
                {configured ? (
                  <>
                    <p className="text-muted-foreground mt-1 font-mono text-[11px]">
                      {JSON.stringify(configured.config)}
                    </p>
                    <label className="text-muted-foreground mt-2 block text-[11px]">
                      Workflow input
                      <textarea
                        className="border-input bg-background mt-1 min-h-16 w-full rounded-md border px-2 py-1.5 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        value={
                          inputDrafts[configured.id] ?? JSON.stringify(configured.input, null, 2)
                        }
                        disabled={!canManage || configured.status === "disabled"}
                        onChange={(event) =>
                          setInputDrafts((current) => ({
                            ...current,
                            [configured.id]: event.target.value,
                          }))
                        }
                      />
                    </label>
                  </>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                {!configured ? (
                  <Button
                    size="sm"
                    disabled={!canManage || busy}
                    onClick={() => void createTrigger(declaration)}
                  >
                    {busy ? <Loader2Icon className="animate-spin" /> : <PlayIcon />} Configure
                  </Button>
                ) : configured.status !== "disabled" ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canManage || busy}
                      onClick={() =>
                        void updateStatus(
                          configured,
                          configured.status === "enabled" ? "paused" : "enabled",
                        )
                      }
                    >
                      {configured.status === "enabled" ? <PauseIcon /> : <PlayIcon />}
                      {configured.status === "enabled" ? "Pause" : "Enable"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canManage || busy || configured.status !== "enabled"}
                      onClick={() => void runNow(configured)}
                    >
                      <PlayIcon /> Run now
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canManage || busy}
                      onClick={() => void saveInput(configured)}
                    >
                      Save input
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!canManage || busy}
                      onClick={() => void updateStatus(configured, "disabled")}
                    >
                      <SquareIcon /> Disable
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          );
        })}
        {!declared.length ? (
          <div className="p-4">
            <EmptyPanelText>This pack does not declare automations.</EmptyPanelText>
          </div>
        ) : null}
      </div>

      {canManage ? (
        <>
          <div className="border-border border-t px-4 py-3">
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
              <BellRingIcon className="size-3.5" /> Operator alerts
            </h3>
            <p className="text-muted-foreground mt-1 text-xs">
              Durable unattended failures remain visible until an operator resolves them.
            </p>
          </div>
          <div className="divide-border divide-y">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                data-testid="operator-alert-row"
                data-alert-id={alert.id}
                className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill status={alert.status} tone={alertSeverityTone(alert.severity)} />
                    <StatusPill
                      status={alert.deliveryStatus}
                      tone={alertDeliveryTone(alert.deliveryStatus)}
                    />
                    <span className="font-mono text-xs">{alert.code}</span>
                  </div>
                  <p className="mt-1 text-sm">{alert.summary}</p>
                  <p className="text-muted-foreground mt-1 truncate text-xs">
                    {alert.targetType ?? "runtime"}
                    {alert.targetId ? ` · ${alert.targetId}` : ""} · {formatTime(alert.createdAt)}
                    {alert.deliveryAttempts ? ` · ${alert.deliveryAttempts} delivery attempts` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {alert.deliveryStatus === "failed" && alert.status !== "resolved" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === alert.id}
                      onClick={() => void retryAlertDelivery(alert)}
                    >
                      <RotateCcwIcon /> Retry delivery
                    </Button>
                  ) : null}
                  {alert.status === "open" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === alert.id}
                      onClick={() => void updateAlert(alert, "acknowledged")}
                    >
                      Acknowledge
                    </Button>
                  ) : null}
                  {alert.status !== "resolved" ? (
                    <Button
                      size="sm"
                      disabled={busyId === alert.id}
                      onClick={() => void updateAlert(alert, "resolved")}
                    >
                      {busyId === alert.id ? (
                        <Loader2Icon className="animate-spin" />
                      ) : (
                        <CheckCircle2Icon />
                      )}
                      Resolve
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
            {!alerts.length ? (
              <div className="p-4">
                <EmptyPanelText>No operator alerts for this workspace.</EmptyPanelText>
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      <div className="border-border border-t px-4 py-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide">Recent dispatches</h3>
      </div>
      <div className="divide-border divide-y">
        {dispatches.map((dispatch) => (
          <div
            key={dispatch.id}
            className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill status={dispatch.status} tone={dispatch.status} />
                <span className="text-muted-foreground text-xs">{dispatch.source}</span>
                <span className="text-muted-foreground text-xs">
                  attempt {dispatch.attemptCount}
                </span>
              </div>
              <p className="text-muted-foreground mt-1 truncate text-xs">
                {dispatch.id} · {formatTime(dispatch.receivedAt)}
              </p>
            </div>
            <div className="flex gap-2">
              {canReplayDispatch(dispatch) ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canManage || busyId === dispatch.id}
                  onClick={() => void replay(dispatch)}
                >
                  {busyId === dispatch.id ? (
                    <Loader2Icon className="animate-spin" />
                  ) : (
                    <RotateCcwIcon />
                  )}{" "}
                  Replay
                </Button>
              ) : null}
              {dispatch.runId ? (
                <Button size="sm" variant="outline" onClick={() => onOpenHistory(dispatch.runId!)}>
                  <ExternalLinkIcon /> History
                </Button>
              ) : null}
            </div>
          </div>
        ))}
        {!dispatches.length ? (
          <div className="p-4">
            <EmptyPanelText>No automation dispatches yet.</EmptyPanelText>
          </div>
        ) : null}
      </div>
    </section>
  );
}
