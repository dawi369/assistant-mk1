import { defineRunnerModule } from "@assistant-mk1/agent-sdk/runner";

import { controlPlane } from "./control-plane";

export const runner = defineRunnerModule({
  packId: controlPlane.packId,
  runtimeVersion: controlPlane.runtimeVersion,
  compatiblePackVersions: controlPlane.compatiblePackVersions,
  tools: controlPlane.tools.filter((tool) => tool.transport === "fly"),
});
