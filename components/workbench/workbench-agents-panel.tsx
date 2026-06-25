"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BotIcon,
  CheckCircle2Icon,
  FileTextIcon,
  Loader2Icon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  ShieldAlertIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { requestWorkbenchSummaryRefresh } from "@/lib/workbench/admin-summary-events";
import {
  buildPackWorkflowRequest,
  resolvePackWorkflowBinding,
  type PackWorkflowBinding,
} from "@/lib/workbench/pack-workflow-bindings";
import type {
  AgentBehaviorTemplate,
  AgentSummary,
  CloudflareAgentBehaviorTemplatesResponse,
  CloudflareAgentMutationResponse,
  CloudflareAgentsResponse,
  CloudflareToolRunResponse,
} from "@/lib/workbench/workbench-types";

const agentsPath = "/api/workbench/agents";
const behaviorTemplatesPath = "/api/workbench/agent-behavior-templates";
const adminAccessPath = "/api/workbench/admin-access";

const readJsonResponse = async <T,>(response: Response, fallback: string): Promise<T> => {
  const body = (await response.json().catch(() => ({}))) as T & { error?: unknown };
  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? body.error : fallback);
  }
  return body;
};

const packRiskLabel = (pack: NonNullable<AgentBehaviorTemplate["pack"]>) =>
  [
    pack.risk.financialData ? "financial-data" : "no-financial-data",
    pack.risk.externalMutation ? "mutation" : "read-only",
    pack.risk.requiresSecrets ? "secrets" : "no-secrets",
    `gate: ${pack.risk.productionGate}`,
  ].join(" / ");

const packToolLabel = (pack: NonNullable<AgentBehaviorTemplate["pack"]>) =>
  pack.tools.map((tool) => tool.id).join(", ");

const packWorkflowLabel = (pack: NonNullable<AgentBehaviorTemplate["pack"]>) =>
  pack.workflows.length
    ? pack.workflows.map((workflow) => `${workflow.type} (${workflow.engine})`).join(", ")
    : "No declared workflows";

export function WorkbenchAgentsPanel({
  open,
  onOpenChange,
  onOpenHistory,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenHistory?: () => void;
}) {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [templates, setTemplates] = useState<AgentBehaviorTemplate[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busyAgentId, setBusyAgentId] = useState<string | null>(null);
  const [busyTemplateId, setBusyTemplateId] = useState<string | null>(null);
  const [busyWorkflowType, setBusyWorkflowType] = useState<string | null>(null);
  const [workflowInputs, setWorkflowInputs] = useState<Record<string, Record<string, unknown>>>({});
  const [workflowResult, setWorkflowResult] = useState<{
    workflowType: string;
    response: CloudflareToolRunResponse;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadAgents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [agentsBody, templatesBody, adminBody] = await Promise.all([
        fetch(agentsPath, { cache: "no-store" }).then((response) =>
          readJsonResponse<CloudflareAgentsResponse>(response, "Failed to load agents"),
        ),
        fetch(behaviorTemplatesPath, { cache: "no-store" }).then((response) =>
          readJsonResponse<CloudflareAgentBehaviorTemplatesResponse>(
            response,
            "Failed to load behavior templates",
          ),
        ),
        fetch(adminAccessPath, { cache: "no-store" })
          .then((response) =>
            readJsonResponse<{ isAdmin?: boolean }>(response, "Admin check failed"),
          )
          .catch(() => ({ isAdmin: false })),
      ]);
      setAgents(agentsBody.agents ?? []);
      setActiveAgentId(agentsBody.activeAgentId ?? null);
      setTemplates(templatesBody.templates ?? []);
      setIsAdmin(adminBody.isAdmin === true);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load agents");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void loadAgents();
  }, [loadAgents, open]);

  const activeAgent = useMemo(
    () =>
      agents.find((agent) => agent.id === activeAgentId) ?? agents.find((agent) => agent.isActive),
    [activeAgentId, agents],
  );
  const activePack = activeAgent?.behavior.pack ?? null;
  const packTemplates = useMemo(() => templates.filter((template) => template.pack), [templates]);
  const activeWorkflowBindings = useMemo(
    () => activePack?.workflows.map((workflow) => resolvePackWorkflowBinding(workflow)) ?? [],
    [activePack],
  );

  const setWorkflowInput = (workflowType: string, field: string, value: unknown) => {
    setWorkflowInputs((current) => ({
      ...current,
      [workflowType]: {
        ...current[workflowType],
        [field]: value,
      },
    }));
  };

  const activateAgent = async (agent: AgentSummary) => {
    setBusyAgentId(agent.id);
    setError(null);
    try {
      const response = await fetch(`${agentsPath}/${encodeURIComponent(agent.id)}/activate`, {
        method: "POST",
      });
      const body = await readJsonResponse<CloudflareAgentMutationResponse>(
        response,
        "Failed to activate agent",
      );
      setActiveAgentId(body.activeAgentId ?? agent.id);
      await loadAgents();
      requestWorkbenchSummaryRefresh({ source: "event" });
    } catch (activateError) {
      setError(activateError instanceof Error ? activateError.message : "Failed to activate agent");
    } finally {
      setBusyAgentId(null);
    }
  };

  const createDemoAgent = async (template: AgentBehaviorTemplate) => {
    setBusyTemplateId(template.id);
    setError(null);
    try {
      const response = await fetch(agentsPath, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: template.name,
          description: template.description,
          profile: template.profile,
          behaviorTemplateId: template.id,
          activate: true,
        }),
      });
      await readJsonResponse<CloudflareAgentMutationResponse>(response, "Failed to create agent");
      await loadAgents();
      requestWorkbenchSummaryRefresh({ source: "event" });
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create agent");
    } finally {
      setBusyTemplateId(null);
    }
  };

  const runWorkflow = async (binding: PackWorkflowBinding) => {
    const request = buildPackWorkflowRequest(
      binding.workflowType,
      workflowInputs[binding.workflowType] ?? binding.defaultInput,
    );
    if (!request) return;

    setBusyWorkflowType(binding.workflowType);
    setWorkflowResult(null);
    setError(null);
    try {
      const response = await fetch(binding.route, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      const body = await readJsonResponse<CloudflareToolRunResponse>(
        response,
        `Failed to run ${binding.label}`,
      );
      setWorkflowResult({ workflowType: binding.workflowType, response: body });
      requestWorkbenchSummaryRefresh({ source: "event" });
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : `Failed to run ${binding.label}`);
      requestWorkbenchSummaryRefresh({ source: "event" });
    } finally {
      setBusyWorkflowType(null);
    }
  };

  const openHistory = () => {
    onOpenChange(false);
    onOpenHistory?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid h-[min(82vh,44rem)] w-[min(92vw,54rem)] max-w-[calc(100vw-2rem)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-[min(92vw,54rem)]">
        <DialogHeader className="border-border border-b px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-base">
            <BotIcon className="text-muted-foreground size-4" />
            Agents
          </DialogTitle>
          <DialogDescription>
            Switch active pack-backed agents and inspect their declared tools, workflows, and risk.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 space-y-4 overflow-auto p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm">
              <span className="text-muted-foreground">Active</span>{" "}
              <span className="font-medium">{activeAgent?.name ?? "No active agent"}</span>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void loadAgents()}
              disabled={loading}
            >
              {loading ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
              Refresh
            </Button>
          </div>

          {error ? (
            <div className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm">
              {error}
            </div>
          ) : null}

          <section className="space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-medium">
              <PlayIcon className="text-muted-foreground size-4" />
              Runnable workflows
            </h3>
            {!activePack ? (
              <p className="text-muted-foreground text-sm">
                Activate a pack-backed agent to run declared read-only workflows.
              </p>
            ) : activeWorkflowBindings.length ? (
              <ol className="space-y-2">
                {activeWorkflowBindings.map((resolved) => {
                  if (!resolved.runnable) {
                    return (
                      <li
                        key={resolved.workflow.type}
                        className="border-border rounded-md border p-3 text-sm"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <span className="min-w-0">
                            <span className="block truncate font-medium">
                              {resolved.workflow.type}
                            </span>
                            <span className="text-muted-foreground mt-1 block text-xs">
                              {resolved.workflow.description}
                            </span>
                          </span>
                          <span className="bg-muted text-muted-foreground rounded px-2 py-1 text-xs">
                            declared only
                          </span>
                        </div>
                      </li>
                    );
                  }

                  const { binding } = resolved;
                  const inputs = workflowInputs[binding.workflowType] ?? {};
                  const canRun = activePack.id === binding.requiredPackId;
                  const result =
                    workflowResult?.workflowType === binding.workflowType
                      ? workflowResult.response
                      : null;

                  return (
                    <li
                      key={binding.workflowType}
                      className="border-border rounded-md border p-3 text-sm"
                    >
                      <div className="flex flex-col gap-3">
                        <div className="flex items-start justify-between gap-3">
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{binding.label}</span>
                            <span className="text-muted-foreground mt-1 block text-xs">
                              {binding.description}
                            </span>
                            <span className="text-muted-foreground mt-1 block text-xs">
                              {binding.workflowType} / dry-run
                            </span>
                          </span>
                          <Button
                            size="sm"
                            disabled={!canRun || busyWorkflowType === binding.workflowType}
                            onClick={() => void runWorkflow(binding)}
                          >
                            {busyWorkflowType === binding.workflowType ? (
                              <Loader2Icon className="animate-spin" />
                            ) : (
                              <PlayIcon />
                            )}
                            Run
                          </Button>
                        </div>

                        <WorkflowInputs
                          binding={binding}
                          inputs={inputs}
                          onChange={(field, value) =>
                            setWorkflowInput(binding.workflowType, field, value)
                          }
                        />

                        {!canRun ? (
                          <p className="text-muted-foreground text-xs">
                            Requires active pack {binding.requiredPackId}.
                          </p>
                        ) : null}

                        {result ? (
                          <div className="bg-muted/40 rounded-md p-3 text-xs">
                            <div className="flex items-start justify-between gap-3">
                              <span className="min-w-0 space-y-1">
                                <span className="block font-medium">
                                  Run {result.run?.status ?? (result.ok ? "accepted" : "failed")}
                                </span>
                                <span className="text-muted-foreground block break-all">
                                  run: {result.run?.id ?? "unknown"}
                                </span>
                                <span className="text-muted-foreground block break-all">
                                  intent: {result.run?.workflowIntentId ?? "unknown"}
                                </span>
                                {result.artifact ? (
                                  <span className="text-muted-foreground block">
                                    artifact: {result.artifact.title ?? result.artifact.id} /{" "}
                                    {result.artifact.kind}
                                  </span>
                                ) : null}
                              </span>
                              {onOpenHistory ? (
                                <Button size="sm" variant="outline" onClick={openHistory}>
                                  <FileTextIcon />
                                  History
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="text-muted-foreground text-sm">
                The active pack does not declare workflows.
              </p>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-medium">Workspace agents</h3>
            {loading && !agents.length ? (
              <p className="text-muted-foreground text-sm">Loading agents.</p>
            ) : agents.length ? (
              <ol className="space-y-2">
                {agents.map((agent) => (
                  <li key={agent.id} className="border-border rounded-md border p-3 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium">{agent.name}</span>
                          {agent.id === activeAgentId || agent.isActive ? (
                            <span className="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs">
                              <CheckCircle2Icon className="size-3" />
                              active
                            </span>
                          ) : null}
                        </div>
                        <p className="text-muted-foreground mt-1 text-xs">
                          {agent.profile} / {agent.runtime.model}
                        </p>
                        {agent.behavior.pack ? (
                          <p className="text-muted-foreground mt-1 text-xs">
                            pack: {agent.behavior.pack.id} / {agent.behavior.pack.capabilityLevel}
                          </p>
                        ) : (
                          <p className="text-muted-foreground mt-1 text-xs">
                            behavior: {agent.behavior.templateId ?? agent.behavior.profile}
                          </p>
                        )}
                      </div>
                      {agent.id === activeAgentId || agent.isActive ? null : (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyAgentId === agent.id || agent.status !== "active"}
                          onClick={() => void activateAgent(agent)}
                        >
                          {busyAgentId === agent.id ? (
                            <Loader2Icon className="animate-spin" />
                          ) : null}
                          Make active
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-muted-foreground text-sm">No workspace agents loaded.</p>
            )}
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-medium">Pack templates</h3>
              {!isAdmin ? (
                <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                  <ShieldAlertIcon className="size-3" />
                  creation is admin-only
                </span>
              ) : null}
            </div>
            {packTemplates.length ? (
              <ol className="space-y-2">
                {packTemplates.map((template) => {
                  const pack = template.pack;
                  if (!pack) return null;
                  const existing = agents.find((agent) => agent.behavior.pack?.id === pack.id);
                  return (
                    <li key={template.id} className="border-border rounded-md border p-3 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                          <p className="truncate font-medium">{template.name}</p>
                          <p className="text-muted-foreground text-xs">{pack.id}</p>
                          <p className="text-muted-foreground text-xs">
                            tools: {packToolLabel(pack)}
                          </p>
                          <p className="text-muted-foreground text-xs">
                            workflows: {packWorkflowLabel(pack)}
                          </p>
                          <p className="text-muted-foreground text-xs">
                            risk: {packRiskLabel(pack)}
                          </p>
                        </div>
                        {existing ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={existing.id === activeAgentId || busyAgentId === existing.id}
                            onClick={() => void activateAgent(existing)}
                          >
                            {existing.id === activeAgentId ? "Active" : "Use"}
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!isAdmin || busyTemplateId === template.id}
                            onClick={() => void createDemoAgent(template)}
                          >
                            {busyTemplateId === template.id ? (
                              <Loader2Icon className="animate-spin" />
                            ) : (
                              <PlusIcon />
                            )}
                            Create
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="text-muted-foreground text-sm">No pack templates loaded.</p>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function WorkflowInputs({
  binding,
  inputs,
  onChange,
}: {
  binding: PackWorkflowBinding;
  inputs: Record<string, unknown>;
  onChange: (field: string, value: unknown) => void;
}) {
  if (!binding.fields.length) return null;

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {binding.fields.includes("query") ? (
        <label className="text-muted-foreground grid gap-1 text-xs">
          Query
          <input
            className="border-input bg-background text-foreground h-8 rounded-md border px-2 text-sm"
            value={String(inputs.query ?? binding.defaultInput.query ?? "GTA")}
            maxLength={80}
            onChange={(event) => onChange("query", event.target.value)}
          />
        </label>
      ) : null}

      {binding.fields.includes("symbol") ? (
        <label className="text-muted-foreground grid gap-1 text-xs">
          Symbol
          <input
            className="border-input bg-background text-foreground h-8 rounded-md border px-2 text-sm uppercase"
            value={String(inputs.symbol ?? "")}
            maxLength={16}
            placeholder="Auto"
            onChange={(event) => onChange("symbol", event.target.value)}
          />
        </label>
      ) : null}

      {binding.fields.includes("tf") ? (
        <label className="text-muted-foreground grid gap-1 text-xs">
          Timeframe
          <select
            className="border-input bg-background text-foreground h-8 rounded-md border px-2 text-sm"
            value={String(inputs.tf ?? binding.defaultInput.tf ?? "1m")}
            onChange={(event) => onChange("tf", event.target.value)}
          >
            <option value="1m">1m</option>
            <option value="5m">5m</option>
            <option value="15m">15m</option>
            <option value="30m">30m</option>
            <option value="1h">1h</option>
          </select>
        </label>
      ) : null}

      {binding.fields.includes("lookbackMinutes") ? (
        <label className="text-muted-foreground grid gap-1 text-xs">
          Lookback minutes
          <input
            className="border-input bg-background text-foreground h-8 rounded-md border px-2 text-sm"
            type="number"
            min={1}
            max={1440}
            value={String(inputs.lookbackMinutes ?? binding.defaultInput.lookbackMinutes ?? 60)}
            onChange={(event) => onChange("lookbackMinutes", event.target.value)}
          />
        </label>
      ) : null}

      {binding.fields.includes("maxBars") ? (
        <label className="text-muted-foreground grid gap-1 text-xs">
          Max bars
          <input
            className="border-input bg-background text-foreground h-8 rounded-md border px-2 text-sm"
            type="number"
            min={1}
            max={200}
            value={String(inputs.maxBars ?? binding.defaultInput.maxBars ?? 25)}
            onChange={(event) => onChange("maxBars", event.target.value)}
          />
        </label>
      ) : null}

      {binding.fields.includes("includeBars") ? (
        <label className="text-muted-foreground flex items-center gap-2 self-end text-xs">
          <input
            className="border-input size-4 rounded"
            type="checkbox"
            checked={inputs.includeBars === undefined ? true : inputs.includeBars !== false}
            onChange={(event) => onChange("includeBars", event.target.checked)}
          />
          Include recent bars
        </label>
      ) : null}
    </div>
  );
}
