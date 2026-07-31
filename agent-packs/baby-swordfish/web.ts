import { defineWebModule } from "@assistant-mk1/agent-sdk/web";

export const web = defineWebModule({
  packId: "baby-swordfish",
  runtimeVersion: "1.0.0",
  compatiblePackVersions: "^1.1.0",
  artifactRenderers: {
    runtime_research_report: { kind: "json", version: 1 },
  },
  managedStateRenderers: {
    "swordfish-research.runtime-research": { kind: "generic_detail", version: 1 },
  },
});
