"use client";

import { CheckIcon, Loader2Icon, PlayIcon, PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyPanelText, StatusPill } from "@/components/workbench/dev-monitor-primitives";
import { WorkbenchAutomationsPanel } from "@/components/workbench/workbench-automations-panel";
import { resolveAdminAgentPackState } from "@/lib/workbench/admin-agent-packs";
import type {
  AgentBehaviorTemplate,
  AgentPackTemplateMetadata,
  AgentSummary,
} from "@/lib/workbench/workbench-types";

const packStateLabel = {
  current: "Current",
  ready: "Ready",
  update_available: "Update available",
  not_instantiated: "Not instantiated",
} as const;

export function AdminAgentsPanel({
  open,
  templates,
  agents,
  activeAgentId,
  currentPack,
  canManageAutomations,
  busyPackId,
  onUsePack,
  onCreateCustomAgent,
  onOpenHistory,
}: {
  open: boolean;
  templates: AgentBehaviorTemplate[];
  agents: AgentSummary[];
  activeAgentId?: string;
  currentPack?: AgentPackTemplateMetadata | null;
  canManageAutomations: boolean;
  busyPackId: string | null;
  onUsePack: (template: AgentBehaviorTemplate) => Promise<void>;
  onCreateCustomAgent: () => void;
  onOpenHistory: (runId: string) => void;
}) {
  return (
    <div className="space-y-5">
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Agents</h2>
            <p className="text-muted-foreground mt-0.5 text-xs">
              Choose the behavior used for new conversations.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={onCreateCustomAgent}>
            <PlusIcon />
            Custom agent
          </Button>
        </div>

        <div className="grid gap-3 lg:grid-cols-3">
          {templates.map((template) => {
            const state = resolveAdminAgentPackState(template, agents, activeAgentId);
            if (!template.pack || !state) return null;
            const busy = busyPackId === template.pack.id;
            return (
              <article
                key={template.id}
                className="border-border bg-background flex flex-col rounded-lg border p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-medium">{template.name}</h3>
                    <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">
                      {template.description}
                    </p>
                  </div>
                  <StatusPill
                    status={packStateLabel[state.state]}
                    tone={state.state === "current" ? "completed" : undefined}
                  />
                </div>

                <p className="text-muted-foreground mt-4 text-xs">
                  v{template.version} · {template.pack.workflows.length} workflow
                  {template.pack.workflows.length === 1 ? "" : "s"} ·{" "}
                  {template.pack.risk.externalMutation ? "Mutation capable" : "Read-only"}
                </p>

                <Button
                  className="mt-4 w-full"
                  size="sm"
                  disabled={busy || state.state === "current"}
                  onClick={() => void onUsePack(template)}
                >
                  {busy ? (
                    <Loader2Icon className="animate-spin" />
                  ) : state.state === "current" ? (
                    <CheckIcon />
                  ) : (
                    <PlayIcon />
                  )}
                  {state.state === "current" ? "Current" : "Use agent"}
                </Button>
              </article>
            );
          })}
        </div>

        {templates.length === 0 ? (
          <EmptyPanelText>No installed agent packs were returned.</EmptyPanelText>
        ) : null}
      </section>

      <WorkbenchAutomationsPanel
        open={open}
        pack={currentPack}
        canManage={canManageAutomations}
        onOpenHistory={onOpenHistory}
      />
    </div>
  );
}
