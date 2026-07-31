import { handlePolymancerMarketResearch } from "./polymancer-workflows";
import { handleRepoReadinessReport } from "./repo-workflows";
import { handleSwordfishRuntimeResearch } from "./swordfish-workflows";
import type { PackWorkflowHandler } from "./pack-workflow-runtime";

export const coreWorkflowProvider: Record<string, PackWorkflowHandler> = {
  "repo.readiness_report": handleRepoReadinessReport,
  "polymancer.market_research": handlePolymancerMarketResearch,
  "swordfish.runtime_research": handleSwordfishRuntimeResearch,
};
