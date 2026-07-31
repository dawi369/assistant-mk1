import { defineWebModule } from "@assistant-mk1/agent-sdk/web";

export const web = defineWebModule({
  packId: "baby-polymancer",
  runtimeVersion: "1.0.0",
  compatiblePackVersions: "^1.1.0",
  artifactRenderers: {
    market_research_report: { kind: "table", version: 1 },
  },
  managedStateRenderers: {
    "polymancer-research.market-research": { kind: "generic_detail", version: 1 },
  },
});
