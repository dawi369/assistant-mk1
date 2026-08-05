import { createWorkbenchClient } from "@assistant-mk1/workbench-client";

const client = createWorkbenchClient({
  baseUrl: "https://example.invalid",
  client: { platform: "web", version: "zero-context" },
  fetch,
});

document.querySelector("#app")!.textContent = String(Boolean(client.session));
