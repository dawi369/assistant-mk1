import { packWorkflowBindings, type PackWorkflowType } from "../../../agent-packs/workflow-catalog";
import { handlePolymancerMarketResearch } from "./polymancer-workflows";
import { handleRepoReadinessReport } from "./repo-workflows";
import { handleSwordfishRuntimeResearch } from "./swordfish-workflows";
import type { AgentIdentity, Env } from "./types";

export type WorkflowInvocationContext =
  | { source: "user" }
  | {
      source: "trigger";
      triggerId: string;
      dispatchId: string;
      leaseOwner: string;
      triggerSource: "manual" | "schedule" | "monitor" | "webhook" | "replay";
      attemptCount: number;
      idempotencyKey: string;
      scheduledFor: string | null;
      previousRunId: string | null;
    };

export type PackWorkflowHandler = (
  request: Request,
  env: Env,
  identity: AgentIdentity,
  invocation: WorkflowInvocationContext,
) => Promise<Response>;

export const packWorkflowHandlers = {
  "repo.readiness_report": handleRepoReadinessReport,
  "polymancer.market_research": handlePolymancerMarketResearch,
  "swordfish.runtime_research": handleSwordfishRuntimeResearch,
} satisfies Record<PackWorkflowType, PackWorkflowHandler>;

export const packWorkflowHandlerForPath = (pathname: string): PackWorkflowHandler | null => {
  const entry = Object.values(packWorkflowBindings).find(
    (binding) => binding.workerRoute === pathname,
  );
  return entry ? packWorkflowHandlers[entry.workflowType as PackWorkflowType] : null;
};
