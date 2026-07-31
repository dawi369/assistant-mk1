import { defineWorkbenchConfig } from "@assistant-mk1/agent-sdk";

export default defineWorkbenchConfig({
  runtimeApiVersion: 1,
  modules: [
    {
      package: "@assistant-mk1/pack-repo-analyst",
      source: "./agent-packs/repo-analyst",
    },
    {
      package: "@assistant-mk1/pack-baby-polymancer",
      source: "./agent-packs/baby-polymancer",
    },
    {
      package: "@assistant-mk1/pack-baby-swordfish",
      source: "./agent-packs/baby-swordfish",
    },
    {
      package: "@assistant-mk1/pack-complex-operator",
      source: "./examples/complex-operator",
      conformanceOnly: true,
    },
  ],
});
