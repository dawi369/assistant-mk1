import {
  handleGetCloudflareDemoRun,
  handleLatestCloudflareDemoRun,
  handleRunCallback,
  handleStartCloudflareDemoRun,
} from "./demo-runs";
import { handleAdminWorkspaceSummary } from "./admin-summary";
import {
  handleControlPlaneEvents,
  handleControlPlaneEventStream,
  handleLatestControlPlaneEvents,
} from "./control-plane-events";
import {
  handleChatBoundarySnapshot,
  handleCreateChatSession,
  handleGetChatSession,
  handleLangGraphFacade,
  handleLatestChatSession,
} from "./langgraph-facade";
import { handleWorkspaceContext } from "./workspace-context";
import { handleActivateWorkspace, handleCreateWorkspace, handleListWorkspaces } from "./workspaces";
import { resolveAgentIdentity } from "./authz";
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

  if (request.method === "POST" && url.pathname === "/internal/workbench/run-callbacks") {
    return handleRunCallback(request, env);
  }

  const identityResult = await resolveAgentIdentity(request, env);
  if (!identityResult.ok) return identityResult.response;
  const { identity } = identityResult;

  if (request.method === "GET" && url.pathname === "/workspace-context") {
    return handleWorkspaceContext(request, env, identity);
  }

  if (request.method === "GET" && url.pathname === "/admin/workspace-summary") {
    return handleAdminWorkspaceSummary(request, env, identity);
  }

  if (request.method === "GET" && url.pathname === "/workspaces") {
    return handleListWorkspaces(env, identity);
  }

  if (request.method === "POST" && url.pathname === "/workspaces") {
    return handleCreateWorkspace(request, env, identity);
  }

  const activateWorkspaceMatch = url.pathname.match(/^\/workspaces\/([^/]+)\/activate$/);
  if (request.method === "POST" && activateWorkspaceMatch?.[1]) {
    return handleActivateWorkspace(env, identity, decodeURIComponent(activateWorkspaceMatch[1]));
  }

  if (request.method === "GET" && url.pathname === "/events/latest") {
    return json(await handleLatestControlPlaneEvents(env, identity, url));
  }

  if (request.method === "GET" && url.pathname === "/events/stream") {
    return handleControlPlaneEventStream(env, identity, url);
  }

  if (request.method === "GET" && url.pathname === "/events") {
    return json(await handleControlPlaneEvents(env, identity, url));
  }

  if (request.method === "POST" && url.pathname === "/sessions") {
    return handleCreateChatSession(request, env, identity);
  }

  if (request.method === "GET" && url.pathname === "/sessions/latest") {
    return handleLatestChatSession(env, identity);
  }

  const sessionMatch = url.pathname.match(/^\/sessions\/([^/]+)$/);
  if (request.method === "GET" && sessionMatch?.[1]) {
    return handleGetChatSession(env, identity, sessionMatch[1]);
  }

  const chatBoundaryMatch = url.pathname.match(
    /^\/internal\/chat-boundary\/threads\/([^/]+)\/snapshot$/,
  );
  if (request.method === "GET" && chatBoundaryMatch?.[1]) {
    return handleChatBoundarySnapshot(env, identity, chatBoundaryMatch[1]);
  }

  if (url.pathname === "/langgraph" || url.pathname.startsWith("/langgraph/")) {
    return handleLangGraphFacade(request, env, ctx, identity, url);
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
