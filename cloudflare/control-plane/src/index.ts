import {
  handleGetCloudflareDemoRun,
  handleLatestCloudflareDemoRun,
  handleRunCallback,
  handleStartCloudflareDemoRun,
} from "./demo-runs";
import { handleLangGraphFacade } from "./langgraph-facade";
import { json, requireAgentIdentity, requireAuth } from "./http";
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

  if (request.method === "POST" && url.pathname === "/internal/workbench/run-callbacks") {
    return handleRunCallback(request, env);
  }

  const identityResult = requireAgentIdentity(request);
  if (!identityResult.ok) return identityResult.response;
  const { identity } = identityResult;

  if (url.pathname === "/langgraph" || url.pathname.startsWith("/langgraph/")) {
    return handleLangGraphFacade(request, env, url);
  }

  if (request.method === "POST" && url.pathname === "/workbench/demo-runs") {
    return handleStartCloudflareDemoRun(request, env, ctx, identity);
  }

  if (request.method === "GET" && url.pathname === "/workbench/demo-runs/latest") {
    return handleLatestCloudflareDemoRun(env, identity.scope);
  }

  const demoRunMatch = url.pathname.match(/^\/workbench\/demo-runs\/([^/]+)$/);
  if (request.method === "GET" && demoRunMatch?.[1]) {
    return handleGetCloudflareDemoRun(env, identity.scope, demoRunMatch[1]);
  }

  return json({ ok: false, error: "not found" }, { status: 404 });
};

export default {
  fetch: handleRequest,
};
