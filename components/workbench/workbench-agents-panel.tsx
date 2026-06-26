"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRightLeftIcon,
  BotIcon,
  ChevronDownIcon,
  CheckCircle2Icon,
  EyeIcon,
  EyeOffIcon,
  FileTextIcon,
  Loader2Icon,
  MessageSquarePlusIcon,
  PlayIcon,
  PlusIcon,
  PackageIcon,
  RefreshCwIcon,
  ShieldAlertIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { requestWorkbenchSummaryRefresh } from "@/lib/workbench/admin-summary-events";
import {
  resolvePackToolCapabilities,
  type PackToolCapability,
} from "@/lib/workbench/pack-capabilities";
import {
  buildPackWorkflowRequest,
  resolvePackWorkflowBinding,
  type PackWorkflowBinding,
} from "@/lib/workbench/pack-workflow-bindings";
import { useWorkbenchAgentConnection } from "@/lib/workbench/use-agent-connection";
import type {
  AgentBehaviorTemplate,
  AgentPackTemplateMetadata,
  AgentSwitchTarget,
  AgentSummary,
  CloudflareAgentBehaviorTemplatesResponse,
  CloudflareAgentMutationResponse,
  CloudflareAgentsResponse,
  CloudflareToolsResponse,
  CloudflareToolRunResponse,
  ToolSummary,
} from "@/lib/workbench/workbench-types";

const agentsPath = "/api/workbench/agents";
const behaviorTemplatesPath = "/api/workbench/agent-behavior-templates";
const adminAccessPath = "/api/workbench/admin-access";
const toolsPath = "/api/workbench/tools?surface=model_exposure&executionMode=dry_run&stage=analyze";

export type AgentPanelEntryMode = "switch" | "workflow";

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
  entryMode = "switch",
  open,
  onOpenChange,
  onOpenHistory,
}: {
  entryMode?: AgentPanelEntryMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenHistory?: () => void;
}) {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [templates, setTemplates] = useState<AgentBehaviorTemplate[]>([]);
  const [toolSummaries, setToolSummaries] = useState<ToolSummary[]>([]);
  const [toolSummaryError, setToolSummaryError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<AgentPanelEntryMode>(entryMode);
  const [packTemplatesOpen, setPackTemplatesOpen] = useState(false);
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
  const [pendingAgent, setPendingAgent] = useState<AgentSummary | null>(null);
  const [busySwitchTarget, setBusySwitchTarget] = useState<AgentSwitchTarget | null>(null);
  const {
    isLocalNewSession,
    pending: sessionPending,
    session,
    switchAgent,
  } = useWorkbenchAgentConnection();

  const loadAgents = useCallback(async () => {
    setLoading(true);
    setError(null);
    setToolSummaryError(null);
    try {
      const [agentsBody, templatesBody, adminBody, toolsBody] = await Promise.all([
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
        fetch(toolsPath, { cache: "no-store" })
          .then((response) =>
            readJsonResponse<CloudflareToolsResponse>(response, "Failed to load tool summaries"),
          )
          .catch((toolsError) => {
            setToolSummaryError(
              toolsError instanceof Error ? toolsError.message : "Failed to load tool summaries",
            );
            return { tools: [] };
          }),
      ]);
      setAgents(agentsBody.agents ?? []);
      setActiveAgentId(agentsBody.activeAgentId ?? null);
      setTemplates(templatesBody.templates ?? []);
      setIsAdmin(adminBody.isAdmin === true);
      setToolSummaries(toolsBody.tools ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load agents");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void loadAgents();
  }, [loadAgents, open]);

  useEffect(() => {
    if (open) setActiveSection(entryMode);
  }, [entryMode, open]);

  const currentThread = session?.activeThread ?? null;
  const hasCurrentThread = Boolean(currentThread && !isLocalNewSession);
  const sessionActiveAgent = session?.activeAgent ?? null;
  const effectiveActiveAgentId = sessionActiveAgent?.id ?? activeAgentId;
  const pendingAgentId = pendingAgent?.id ?? null;
  const activeAgent = useMemo(
    () =>
      agents.find((agent) => agent.id === effectiveActiveAgentId) ??
      sessionActiveAgent ??
      agents.find((agent) => agent.isActive),
    [effectiveActiveAgentId, sessionActiveAgent, agents],
  );
  const activePack = activeAgent?.behavior.pack ?? null;
  const activePackId = activePack?.id ?? null;
  const packTemplates = useMemo(() => templates.filter((template) => template.pack), [templates]);
  const activeWorkflowBindings = useMemo(
    () => activePack?.workflows.map((workflow) => resolvePackWorkflowBinding(workflow)) ?? [],
    [activePack],
  );
  const activeToolCapabilities = useMemo(
    () => resolvePackToolCapabilities(activePack, toolSummaries),
    [activePack, toolSummaries],
  );

  useEffect(() => {
    if (!open) {
      setPendingAgent(null);
      setBusySwitchTarget(null);
      return;
    }
    if (pendingAgentId && (!hasCurrentThread || pendingAgentId === effectiveActiveAgentId)) {
      setPendingAgent(null);
    }
  }, [effectiveActiveAgentId, hasCurrentThread, open, pendingAgentId]);

  useEffect(() => {
    setWorkflowResult(null);
  }, [activePackId]);

  const setWorkflowInput = (workflowType: string, field: string, value: unknown) => {
    setWorkflowInputs((current) => ({
      ...current,
      [workflowType]: {
        ...current[workflowType],
        [field]: value,
      },
    }));
  };

  const switchToAgent = async (agent: AgentSummary, target: AgentSwitchTarget) => {
    setBusyAgentId(agent.id);
    setBusySwitchTarget(target);
    setError(null);
    try {
      await switchAgent(
        agent.id,
        target,
        target === "current_thread" ? currentThread?.threadId : undefined,
      );
      setActiveAgentId(agent.id);
      setPendingAgent(null);
      await loadAgents();
      requestWorkbenchSummaryRefresh({ source: "event" });
      onOpenChange(false);
    } catch (switchError) {
      setError(switchError instanceof Error ? switchError.message : "Failed to switch agent");
    } finally {
      setBusyAgentId(null);
      setBusySwitchTarget(null);
    }
  };

  const selectAgent = (agent: AgentSummary) => {
    if (agent.status !== "active") return;
    if (hasCurrentThread && agent.id !== effectiveActiveAgentId) {
      setPendingAgent(agent);
      return;
    }
    void switchToAgent(agent, "new_thread");
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
      const body = await readJsonResponse<CloudflareAgentMutationResponse>(
        response,
        "Failed to create agent",
      );
      const createdAgent = body.agent ?? null;
      if (createdAgent?.id) {
        await switchAgent(createdAgent.id, "new_thread");
        setActiveAgentId(createdAgent.id);
      }
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
    onOpenHistory?.();
    onOpenChange(false);
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
            Switch the active chat agent or choose the default agent for your next chat.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 space-y-4 overflow-auto p-5">
          {error ? (
            <div className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm">
              {error}
            </div>
          ) : null}

          <section className="space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-medium">
              <MessageSquarePlusIcon className="text-muted-foreground size-4" />
              Active chat context
            </h3>
            <div className="border-border rounded-md border p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-muted-foreground text-xs">
                    {hasCurrentThread ? "Current thread" : "Next chat default"}
                  </p>
                  <p className="truncate font-medium">
                    {hasCurrentThread
                      ? currentThread?.title || currentThread?.threadId
                      : "Blank chat composer"}
                  </p>
                </div>
                <span className="bg-muted text-muted-foreground rounded px-2 py-1 text-xs">
                  {hasCurrentThread ? "handoff available" : "new chat"}
                </span>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <ContextField label="Agent" value={activeAgent?.name ?? "No active agent"} />
                <ContextField
                  label="Model / profile"
                  value={
                    activeAgent ? `${activeAgent.runtime.model} / ${activeAgent.profile}` : "None"
                  }
                />
                <ContextField
                  label="Pack"
                  value={
                    activePack
                      ? `${activePack.id} / ${activePack.capabilityLevel}`
                      : "No pack attached"
                  }
                />
                <ContextField
                  label="Workflows"
                  value={
                    activePack?.workflows.length
                      ? activePack.workflows.map((workflow) => workflow.type).join(", ")
                      : "None"
                  }
                />
              </div>
            </div>
          </section>

          <ActivePackCapabilities
            activePack={activePack}
            capabilities={activeToolCapabilities}
            toolSummaryError={toolSummaryError}
          />

          <AgentPanelModeSwitch activeSection={activeSection} onChange={setActiveSection} />

          {activeSection === "switch" ? (
            <section className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <h3 className="flex items-center gap-2 text-sm font-medium">
                  <ArrowRightLeftIcon className="text-muted-foreground size-4" />
                  Available agents
                </h3>
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
              {loading && !agents.length ? (
                <p className="text-muted-foreground text-sm">Loading agents.</p>
              ) : agents.length ? (
                <ol className="space-y-2">
                  {agents.map((agent) => {
                    const isCurrentAgent = agent.id === effectiveActiveAgentId;
                    const pack = agent.behavior.pack;
                    const showConfirmation = pendingAgent?.id === agent.id;
                    const isBusy =
                      busyAgentId === agent.id ||
                      (sessionPending?.type === "agent_handoff" &&
                        sessionPending.agentId === agent.id);
                    const isThreadRunning = currentThread?.latestRunStatus === "running";

                    return (
                      <li key={agent.id} className="border-border rounded-md border p-3 text-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="truncate font-medium">{agent.name}</span>
                              {isCurrentAgent ? (
                                <span className="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs">
                                  <CheckCircle2Icon className="size-3" />
                                  {hasCurrentThread ? "current" : "default"}
                                </span>
                              ) : null}
                              {agent.status !== "active" ? (
                                <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-xs">
                                  {agent.status}
                                </span>
                              ) : null}
                            </div>
                            <p className="text-muted-foreground mt-1 text-xs">
                              {agent.profile} / {agent.runtime.model}
                            </p>
                            {pack ? (
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-xs">
                                  pack: {pack.id}
                                </span>
                                <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-xs">
                                  {pack.capabilityLevel}
                                </span>
                                <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-xs">
                                  tools: {pack.tools.length}
                                </span>
                                <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-xs">
                                  workflows: {pack.workflows.length}
                                </span>
                              </div>
                            ) : (
                              <p className="text-muted-foreground mt-1 text-xs">
                                behavior: {agent.behavior.templateId ?? agent.behavior.profile}
                              </p>
                            )}
                            {pack ? (
                              <p className="text-muted-foreground mt-2 text-xs">
                                risk: {packRiskLabel(pack)}
                              </p>
                            ) : null}
                          </div>
                          <Button
                            size="sm"
                            variant={isCurrentAgent ? "secondary" : "outline"}
                            disabled={isCurrentAgent || isBusy || agent.status !== "active"}
                            onClick={() => selectAgent(agent)}
                          >
                            {isBusy && !busySwitchTarget ? (
                              <Loader2Icon className="animate-spin" />
                            ) : null}
                            {isCurrentAgent
                              ? hasCurrentThread
                                ? "Current"
                                : "Default"
                              : hasCurrentThread
                                ? "Switch"
                                : "Use"}
                          </Button>
                        </div>

                        {showConfirmation ? (
                          <div className="border-border bg-muted/30 mt-3 rounded-md border p-3">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div className="min-w-0">
                                <p className="font-medium">Continue this chat with {agent.name}?</p>
                                <p className="text-muted-foreground mt-1 text-xs">
                                  Existing messages stay in context. Future replies use this
                                  agent&apos;s tools and behavior.
                                </p>
                                {isThreadRunning ? (
                                  <p className="text-destructive mt-2 text-xs">
                                    Wait for the current response before switching this chat.
                                  </p>
                                ) : null}
                              </div>
                              <div className="flex shrink-0 flex-wrap items-center gap-2">
                                <Button
                                  size="sm"
                                  disabled={isThreadRunning || isBusy}
                                  onClick={() => void switchToAgent(agent, "current_thread")}
                                >
                                  {isBusy && busySwitchTarget === "current_thread" ? (
                                    <Loader2Icon className="animate-spin" />
                                  ) : null}
                                  Continue this chat
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={isBusy}
                                  onClick={() => void switchToAgent(agent, "new_thread")}
                                >
                                  {isBusy && busySwitchTarget === "new_thread" ? (
                                    <Loader2Icon className="animate-spin" />
                                  ) : null}
                                  Start new chat
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="size-8"
                                  aria-label="Cancel agent switch"
                                  onClick={() => setPendingAgent(null)}
                                >
                                  <XIcon className="size-4" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="text-muted-foreground text-sm">No workspace agents loaded.</p>
              )}

              <Collapsible
                open={packTemplatesOpen}
                onOpenChange={setPackTemplatesOpen}
                className="border-border rounded-md border"
              >
                <CollapsibleTrigger className="hover:bg-muted/50 flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm">
                  <span className="flex min-w-0 items-center gap-2 font-medium">
                    <PackageIcon className="text-muted-foreground size-4" />
                    Pack templates
                    {!isAdmin ? (
                      <span className="text-muted-foreground inline-flex items-center gap-1 text-xs font-normal">
                        <ShieldAlertIcon className="size-3" />
                        admin-only creation
                      </span>
                    ) : null}
                  </span>
                  <ChevronDownIcon className="text-muted-foreground size-4 shrink-0 transition-transform data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-2 border-t p-3">
                  {packTemplates.length ? (
                    <ol className="space-y-2">
                      {packTemplates.map((template) => {
                        const pack = template.pack;
                        if (!pack) return null;
                        const existing = agents.find(
                          (agent) => agent.behavior.pack?.id === pack.id,
                        );
                        return (
                          <li
                            key={template.id}
                            className="border-border rounded-md border p-3 text-sm"
                          >
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
                                  disabled={
                                    existing.id === effectiveActiveAgentId ||
                                    busyAgentId === existing.id
                                  }
                                  onClick={() => selectAgent(existing)}
                                >
                                  {existing.id === effectiveActiveAgentId ? "Current" : "Use"}
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
                </CollapsibleContent>
              </Collapsible>
            </section>
          ) : null}

          {activeSection === "workflow" ? (
            <section className="space-y-2">
              <h3 className="flex items-center gap-2 text-sm font-medium">
                <PlayIcon className="text-muted-foreground size-4" />
                Active pack workflow runner
              </h3>
              {!activePack ? (
                <p className="text-muted-foreground text-sm">
                  Select a pack-backed agent to run declared read-only workflows.
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
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AgentPanelModeSwitch({
  activeSection,
  onChange,
}: {
  activeSection: AgentPanelEntryMode;
  onChange: (section: AgentPanelEntryMode) => void;
}) {
  return (
    <div className="bg-muted/50 grid grid-cols-2 rounded-md p-1 text-sm">
      <Button
        size="sm"
        variant={activeSection === "switch" ? "secondary" : "ghost"}
        className="justify-center"
        onClick={() => onChange("switch")}
      >
        <ArrowRightLeftIcon className="size-4" />
        Agents
      </Button>
      <Button
        size="sm"
        variant={activeSection === "workflow" ? "secondary" : "ghost"}
        className="justify-center"
        onClick={() => onChange("workflow")}
      >
        <PlayIcon className="size-4" />
        Run workflow
      </Button>
    </div>
  );
}

function ActivePackCapabilities({
  activePack,
  capabilities,
  toolSummaryError,
}: {
  activePack: AgentPackTemplateMetadata | null;
  capabilities: PackToolCapability[];
  toolSummaryError: string | null;
}) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <WrenchIcon className="text-muted-foreground size-4" />
        Active pack capabilities
      </h3>
      {!activePack ? (
        <div className="border-border rounded-md border p-3 text-sm">
          <p className="text-muted-foreground">
            Select a pack-backed agent to see declared tools and workflows.
          </p>
        </div>
      ) : (
        <div className="border-border rounded-md border p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{activePack.id}</span>
            <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-xs">
              {activePack.capabilityLevel}
            </span>
            <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-xs">
              {activePack.risk.externalMutation ? "mutation-capable" : "read-only"}
            </span>
            <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-xs">
              gate: {activePack.risk.productionGate ?? "none"}
            </span>
          </div>
          {toolSummaryError ? (
            <p className="text-muted-foreground mt-2 text-xs">
              Live tool policy unavailable; showing declared pack metadata.
            </p>
          ) : null}
          {capabilities.length ? (
            <ol className="mt-3 grid gap-2 md:grid-cols-2">
              {capabilities.map((capability) => (
                <PackToolCapabilityItem key={capability.id} capability={capability} />
              ))}
            </ol>
          ) : (
            <p className="text-muted-foreground mt-3 text-sm">No declared pack tools.</p>
          )}
          {activePack.workflows.length ? (
            <div className="mt-3 border-t pt-3">
              <p className="text-muted-foreground mb-2 text-xs">Declared workflows</p>
              <div className="flex flex-wrap gap-1.5">
                {activePack.workflows.map((workflow) => (
                  <span
                    key={workflow.type}
                    className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-xs"
                  >
                    {workflow.type} / {workflow.engine ?? "workflow"} / dry-run
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function PackToolCapabilityItem({ capability }: { capability: PackToolCapability }) {
  const modelVisible = capability.modelVisible === true;
  const modelVisibilityKnown = typeof capability.modelVisible === "boolean";
  return (
    <li className="bg-muted/30 rounded-md p-2.5">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0">
          <span className="block truncate font-medium">{capability.id}</span>
          {capability.purpose ? (
            <span className="text-muted-foreground mt-1 block line-clamp-2 text-xs">
              {capability.purpose}
            </span>
          ) : null}
        </span>
        <span
          className={
            modelVisible
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs"
              : "bg-muted text-muted-foreground inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs"
          }
        >
          {modelVisible ? <EyeIcon className="size-3" /> : <EyeOffIcon className="size-3" />}
          {modelVisible ? "chat-visible" : modelVisibilityKnown ? "chat-hidden" : "manifest"}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <span className="bg-background text-muted-foreground rounded px-1.5 py-0.5 text-xs">
          {capability.executionModes.length ? capability.executionModes.join(", ") : "declared"}
        </span>
        <span className="bg-background text-muted-foreground rounded px-1.5 py-0.5 text-xs">
          {capability.mutationRisk ?? "read_only"}
        </span>
        <span className="bg-background text-muted-foreground rounded px-1.5 py-0.5 text-xs">
          {capability.registered ? "registered" : "declared"}
        </span>
        {capability.required ? (
          <span className="bg-background text-muted-foreground rounded px-1.5 py-0.5 text-xs">
            required
          </span>
        ) : null}
      </div>
    </li>
  );
}

function ContextField({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted/40 rounded-md px-2.5 py-2">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-0.5 truncate text-sm font-medium">{value}</p>
    </div>
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
