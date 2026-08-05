import { createWorkbenchClient } from "@assistant-mk1/workbench-client";

export const browserWorkbenchClient = createWorkbenchClient({
  baseUrl: "",
  client: { platform: "web", version: "0.1.0" },
});
