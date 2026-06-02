import {
  handleGetCloudflareDemoRun,
  handleLatestCloudflareDemoRun,
  handleRunCallback,
  handleStartCloudflareDemoRun,
} from "./demo-runs";
import { json, requireAuth } from "./http";
import type { Env, WorkerExecutionContext } from "./types";

const handleRequest = async (request: Request, env: Env, ctx: WorkerExecutionContext) => {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/health") {
    return json({
      ok: true,
      service: "assistant-mk1-control-plane",
      storage: "d1-local",
    });
  }

  const authResponse = requireAuth(request, env);
  if (authResponse) return authResponse;

  if (request.method === "POST" && url.pathname === "/workbench/demo-runs") {
    return handleStartCloudflareDemoRun(request, env, ctx);
  }

  if (request.method === "GET" && url.pathname === "/workbench/demo-runs/latest") {
    return handleLatestCloudflareDemoRun(env);
  }

  const demoRunMatch = url.pathname.match(/^\/workbench\/demo-runs\/([^/]+)$/);
  if (request.method === "GET" && demoRunMatch?.[1]) {
    return handleGetCloudflareDemoRun(env, demoRunMatch[1]);
  }

  if (request.method === "POST" && url.pathname === "/internal/workbench/run-callbacks") {
    return handleRunCallback(request, env);
  }

  return json({ ok: false, error: "not found" }, { status: 404 });
};

export default {
  fetch: handleRequest,
};
