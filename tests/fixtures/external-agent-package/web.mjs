import { defineWebModule } from "@assistant-mk1/agent-sdk/web";

export const web = defineWebModule({
  packId: "external-agent-fixture",
  runtimeVersion: "1.0.0",
  compatiblePackVersions: "^1.0.0",
  artifactRenderers: {},
  managedStateRenderers: {},
});
