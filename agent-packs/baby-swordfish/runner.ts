import { defineRunnerModule } from "@assistant-mk1/agent-sdk/runner";

export const runner = defineRunnerModule({
  packId: "baby-swordfish",
  runtimeVersion: "1.1.0",
  compatiblePackVersions: "^1.2.0",
  tools: [],
});
