import { defineRunnerModule } from "@assistant-mk1/agent-sdk/runner";

export const runner = defineRunnerModule({
  packId: "baby-polymancer",
  runtimeVersion: "1.0.0",
  compatiblePackVersions: "^1.1.0",
  tools: [],
});
