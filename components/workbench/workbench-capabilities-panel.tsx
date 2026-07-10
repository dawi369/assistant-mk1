"use client";

import { useMemo, type ReactNode } from "react";
import { BotIcon, CircleUserRoundIcon, PlayIcon, WorkflowIcon, WrenchIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { resolveAgentSlashWorkflowActions } from "@/lib/workbench/agent-slash-actions";
import { resolvePackToolCapabilities } from "@/lib/workbench/pack-capabilities";
import { useWorkbenchAgentConnection } from "@/lib/workbench/use-agent-connection";

export function WorkbenchCapabilitiesPanel({
  open,
  onOpenChange,
  onCloseAutoFocus,
  onRunWorkflow,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
  onRunWorkflow: (workflowType: string) => void;
}) {
  const { session } = useWorkbenchAgentConnection();
  const agent = session?.activeAgent ?? null;
  const pack = agent?.behavior.pack ?? null;
  const tools = useMemo(() => resolvePackToolCapabilities(pack), [pack]);
  const workflowActions = useMemo(() => resolveAgentSlashWorkflowActions(pack), [pack]);
  const workflowActionByType = useMemo(
    () => new Map(workflowActions.map((action) => [action.binding.workflowType, action])),
    [workflowActions],
  );
  const userTools = tools.filter((tool) => tool.invocation === "user");
  const agentTools = tools.filter((tool) => tool.invocation === "agent");
  const workflowTools = tools.filter((tool) => tool.invocation === "workflow");
  const userWorkflows =
    pack?.workflows.filter((workflow) => workflow.userInvocable !== false) ?? [];

  const closeFromOverlay = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="grid max-h-[min(82vh,44rem)] w-[min(92vw,40rem)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-[min(92vw,40rem)]"
        onCloseAutoFocus={onCloseAutoFocus}
        onOverlayMouseDown={closeFromOverlay}
        onOverlayPointerDown={closeFromOverlay}
        onOverlayTouchStart={closeFromOverlay}
      >
        <DialogHeader className="border-border border-b px-5 py-4 pr-12">
          <DialogTitle className="flex items-center gap-2 text-base">
            <WrenchIcon className="text-muted-foreground size-4" />
            {pack?.name ?? agent?.name ?? "Agent"} tools
          </DialogTitle>
          <DialogDescription>
            What you can run and what this agent uses behind the scenes.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 space-y-5 overflow-y-auto p-5">
          {!pack ? (
            <p className="text-muted-foreground text-sm">
              This agent does not declare a capability pack.
            </p>
          ) : (
            <>
              <CapabilitySection
                icon={CircleUserRoundIcon}
                title="Available to you"
                description="Direct tools and bounded workflows you can start from this chat."
              >
                {userWorkflows.map((workflow) => {
                  const action = workflowActionByType.get(workflow.type);
                  return (
                    <CapabilityRow
                      key={workflow.type}
                      name={action?.label ?? workflow.type}
                      description={workflow.description ?? "Bounded workflow."}
                      badge={`${workflow.engine} flow`}
                      action={
                        action ? (
                          <Button
                            size="sm"
                            onClick={() => {
                              onOpenChange(false);
                              onRunWorkflow(workflow.type);
                            }}
                          >
                            <PlayIcon />
                            Run
                          </Button>
                        ) : (
                          <span className="text-muted-foreground text-xs">Unavailable</span>
                        )
                      }
                    />
                  );
                })}
                {userTools.map((tool) => (
                  <CapabilityRow
                    key={tool.id}
                    name={tool.id}
                    description={tool.purpose ?? "Direct user tool."}
                    badge="direct tool"
                  />
                ))}
                {userWorkflows.length === 0 && userTools.length === 0 ? (
                  <EmptyCapabilityRow text="No user-runnable tools are declared for this agent." />
                ) : null}
              </CapabilitySection>

              <CapabilitySection
                icon={BotIcon}
                title="Agent only"
                description="Conversational tools the agent may choose without a separate launcher."
              >
                {agentTools.map((tool) => (
                  <CapabilityRow
                    key={tool.id}
                    name={tool.id}
                    description={tool.purpose ?? "Agent-only tool."}
                    badge={tool.modelVisibleDefault ? "model visible" : "policy gated"}
                  />
                ))}
                {agentTools.length === 0 ? (
                  <EmptyCapabilityRow text="No conversational agent-only tools are enabled." />
                ) : null}
              </CapabilitySection>

              <CapabilitySection
                icon={WorkflowIcon}
                title="Inside workflows"
                description="Internal adapters used by the bounded workflow above."
              >
                {workflowTools.map((tool) => (
                  <CapabilityRow
                    key={tool.id}
                    name={tool.id}
                    description={tool.purpose ?? "Workflow-internal tool."}
                    badge={tool.executionModes.join(" / ") || "bounded"}
                  />
                ))}
                {workflowTools.length === 0 ? (
                  <EmptyCapabilityRow text="No workflow-internal tools are declared." />
                ) : null}
              </CapabilitySection>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CapabilitySection({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof WrenchIcon;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-start gap-2">
        <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-muted-foreground text-xs">{description}</p>
        </div>
      </div>
      <div className="border-border overflow-hidden rounded-md border">{children}</div>
    </section>
  );
}

function CapabilityRow({
  name,
  description,
  badge,
  action,
}: {
  name: string;
  description: string;
  badge: string;
  action?: ReactNode;
}) {
  return (
    <div className="border-border flex min-w-0 items-center gap-3 border-b px-3 py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <p className="break-all text-sm font-medium">{name}</p>
          <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[11px]">
            {badge}
          </span>
        </div>
        <p className="text-muted-foreground mt-1 text-xs leading-5 whitespace-normal">
          {description}
        </p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

function EmptyCapabilityRow({ text }: { text: string }) {
  return <p className="text-muted-foreground px-3 py-3 text-xs">{text}</p>;
}
