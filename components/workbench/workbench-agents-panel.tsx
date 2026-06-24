"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BotIcon,
  CheckCircle2Icon,
  Loader2Icon,
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
import type {
  AgentBehaviorTemplate,
  AgentSummary,
  CloudflareAgentBehaviorTemplatesResponse,
  CloudflareAgentMutationResponse,
  CloudflareAgentsResponse,
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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [templates, setTemplates] = useState<AgentBehaviorTemplate[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busyAgentId, setBusyAgentId] = useState<string | null>(null);
  const [busyTemplateId, setBusyTemplateId] = useState<string | null>(null);
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
  const packTemplates = useMemo(() => templates.filter((template) => template.pack), [templates]);

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
