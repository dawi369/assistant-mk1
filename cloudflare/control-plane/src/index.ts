import * as Sentry from "@sentry/cloudflare";
import { routeAgentRequest } from "agents";
import {
  handleGetCloudflareDemoRun,
  handleLatestCloudflareDemoRun,
  handleStartCloudflareDemoRun,
} from "./demo-runs";
import { handleLegacyWorkflowCallback, handleWorkflowCallback } from "./workflow-callbacks";
import { handleAdminWorkspaceSummary } from "./admin-summary";
import {
  handleApproveToolApproval,
  handleDenyToolApproval,
  handleListToolApprovals,
  handleListTools,
  handleRunTool,
  handleUpdateToolPolicy,
} from "./admin-tools";
import {
  handleActivateAgent,
  handleCreateAgent,
  handleListAgentBehaviorTemplates,
  handleListAgents,
} from "./agents";
import { handleChatRuntimeSummary } from "./chat-runtime-summary";
import {
  handleActivateChatSessionThread,
  handleChatSession,
  handleChatSessionStream,
  handleCreateChatSessionThread,
  handleListChatSessionThreads,
  handleUpdateChatSessionThread,
} from "./chat-session";
import { handleGetChatThread, handleListChatThreads } from "./chat-threads";
import {
  handleControlPlaneEvents,
  handleControlPlaneEventStream,
  handleLatestControlPlaneEvents,
} from "./control-plane-events";
import { corsHeadersForRequest, withCors } from "./cors";
import {
  handleChatBoundarySnapshot,
  handleCreateChatSession,
  handleGetChatSession,
  handleLangGraphFacade,
  handleLatestChatSession,
} from "./langgraph-facade";
import { handleExternalSignal } from "./external-signals";
import {
  getTraceId,
  handleGetRuntimeTrace,
  handleLatestRuntimeTraces,
  readVercelTimingHeaders,
} from "./runtime-traces";
import { handleWorkspaceContext } from "./workspace-context";
import {
  getExecutionHistoryRun,
  listArtifactHistory,
  listExecutionHistory,
} from "./workbench-history";
import { handleActivateWorkspace, handleCreateWorkspace, handleListWorkspaces } from "./workspaces";
import { resolveAgentIdentity } from "./authz";
import { internalErrorResponse, json, requireControlPlaneAuth, requireDevToken } from "./http";
import type { Env, WorkerExecutionContext } from "./types";
import { WorkbenchThreadChatAgent } from "./thread-chat-agent";
import { WorkbenchSessionAgent } from "./session-agent";

export { WorkbenchThreadChatAgent };
export { WorkbenchSessionAgent };

const isCloudflareAgentSdkPath = (pathname: string) => {
  if (pathname === "/agents" || /^\/agents\/[^/]+\/activate$/.test(pathname)) return false;
  return pathname.startsWith("/agents/") || pathname.startsWith("/agents_");
};

const handleRequest = async (request: Request, env: Env, ctx: WorkerExecutionContext) => {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/health") {
    return json({
      ok: true,
      service: "assistant-mk1-control-plane",
      storage: "d1-local",
    });
  }

  if (isCloudflareAgentSdkPath(url.pathname)) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeadersForRequest(request, env) });
    }
    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) return withCors(agentResponse, request, env);
    return withCors(
      json({ ok: false, error: "Agent route not found" }, { status: 404 }),
      request,
      env,
    );
  }

  if (request.method === "POST" && url.pathname === "/internal/workbench/run-callbacks") {
    const authResponse = await requireDevToken(request, env);
    if (authResponse) return authResponse;
    return handleLegacyWorkflowCallback(request, env);
  }

  if (request.method === "POST" && url.pathname === "/workbench/run-callbacks") {
    return handleWorkflowCallback(request, env);
  }

  const authResult = await requireControlPlaneAuth(request, env);
  if (!authResult.ok) return authResult.response;

  const authzStartedAtMs = Date.now();
  const identityResult = await resolveAgentIdentity(request, env, authResult.context);
  const authzEndedAtMs = Date.now();
  if (!identityResult.ok) return identityResult.response;
  const { identity } = identityResult;
  const vercelTiming = readVercelTimingHeaders(request);
  const incomingTrace = {
    traceId: getTraceId(request),
    authzStartedAtMs,
    authzEndedAtMs,
    authzSpans: identityResult.authzSpans,
    vercelStartedAtMs: vercelTiming.startedAtMs,
    vercelDurationMs: vercelTiming.durationMs,
  };

  if (request.method === "GET" && url.pathname === "/workspace-context") {
    return handleWorkspaceContext(request, env, identity);
  }

  if (request.method === "GET" && url.pathname === "/admin/workspace-summary") {
    return handleAdminWorkspaceSummary(request, env, identity);
  }

  if (request.method === "GET" && url.pathname === "/tools") {
    return handleListTools(request, env, identity);
  }

  if (request.method === "POST" && url.pathname === "/tools/runs") {
    return handleRunTool(request, env, identity, incomingTrace);
  }

  if (request.method === "POST" && url.pathname === "/external-signals") {
    return handleExternalSignal(request, env, identity);
  }

  if (request.method === "POST" && url.pathname === "/tools/policy") {
    return handleUpdateToolPolicy(request, env, identity);
  }

  if (request.method === "GET" && url.pathname === "/tools/approvals") {
    return handleListToolApprovals(request, env, identity);
  }

  const approveToolApprovalMatch = url.pathname.match(/^\/tools\/approvals\/([^/]+)\/approve$/);
  if (request.method === "POST" && approveToolApprovalMatch?.[1]) {
    return handleApproveToolApproval(
      env,
      identity,
      decodeURIComponent(approveToolApprovalMatch[1]),
    );
  }

  const denyToolApprovalMatch = url.pathname.match(/^\/tools\/approvals\/([^/]+)\/deny$/);
  if (request.method === "POST" && denyToolApprovalMatch?.[1]) {
    return handleDenyToolApproval(
      request,
      env,
      identity,
      decodeURIComponent(denyToolApprovalMatch[1]),
    );
  }

  if (request.method === "GET" && url.pathname === "/runtime/traces/latest") {
    return handleLatestRuntimeTraces(env, identity, url);
  }

  const runtimeTraceMatch = url.pathname.match(/^\/runtime\/traces\/([^/]+)$/);
  if (request.method === "GET" && runtimeTraceMatch?.[1]) {
    return handleGetRuntimeTrace(env, identity, decodeURIComponent(runtimeTraceMatch[1]));
  }

  if (request.method === "GET" && url.pathname === "/chat/runtime-summary") {
    return handleChatRuntimeSummary(env, identity);
  }

  if (request.method === "GET" && url.pathname === "/chat/session") {
    return handleChatSession(request, env, identity);
  }

  if (request.method === "GET" && url.pathname === "/chat/session/stream") {
    return handleChatSessionStream(request, env, identity);
  }

  if (request.method === "GET" && url.pathname === "/chat/session/threads") {
    return handleListChatSessionThreads(request, env, identity);
  }

  if (request.method === "POST" && url.pathname === "/chat/session/threads") {
    return handleCreateChatSessionThread(request, env, identity);
  }

  const activateChatSessionThreadMatch = url.pathname.match(
    /^\/chat\/session\/threads\/([^/]+)\/activate$/,
  );
  if (request.method === "POST" && activateChatSessionThreadMatch?.[1]) {
    return handleActivateChatSessionThread(
      request,
      env,
      identity,
      decodeURIComponent(activateChatSessionThreadMatch[1]),
    );
  }

  const updateChatSessionThreadMatch = url.pathname.match(/^\/chat\/session\/threads\/([^/]+)$/);
  if (request.method === "PATCH" && updateChatSessionThreadMatch?.[1]) {
    return handleUpdateChatSessionThread(
      request,
      env,
      identity,
      decodeURIComponent(updateChatSessionThreadMatch[1]),
    );
  }

  if (request.method === "GET" && url.pathname === "/chat/threads") {
    return handleListChatThreads(env, identity, url);
  }

  const chatThreadMatch = url.pathname.match(/^\/chat\/threads\/([^/]+)$/);
  if (request.method === "GET" && chatThreadMatch?.[1]) {
    return handleGetChatThread(env, identity, decodeURIComponent(chatThreadMatch[1]));
  }

  if (request.method === "GET" && url.pathname === "/workbench/history/runs") {
    return listExecutionHistory(env, identity, url);
  }

  const historyRunMatch = url.pathname.match(/^\/workbench\/history\/runs\/([^/]+)$/);
  if (request.method === "GET" && historyRunMatch?.[1]) {
    return getExecutionHistoryRun(env, identity, decodeURIComponent(historyRunMatch[1]));
  }

  if (request.method === "GET" && url.pathname === "/workbench/history/artifacts") {
    return listArtifactHistory(env, identity, url);
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

  if (request.method === "GET" && url.pathname === "/agents") {
    return handleListAgents(env, identity);
  }

  if (request.method === "GET" && url.pathname === "/agent-behavior-templates") {
    return handleListAgentBehaviorTemplates();
  }

  if (request.method === "POST" && url.pathname === "/agents") {
    return handleCreateAgent(request, env, identity);
  }

  const activateAgentMatch = url.pathname.match(/^\/agents\/([^/]+)\/activate$/);
  if (request.method === "POST" && activateAgentMatch?.[1]) {
    return handleActivateAgent(env, identity, decodeURIComponent(activateAgentMatch[1]));
  }

  if (request.method === "GET" && url.pathname === "/events/latest") {
    return json(await handleLatestControlPlaneEvents(env, identity, url));
  }

  if (request.method === "GET" && url.pathname === "/events/stream") {
    return handleControlPlaneEventStream(env, identity, request);
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
    return handleLangGraphFacade(request, env, ctx, identity, url, incomingTrace);
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

const parseSampleRate = (value: string | undefined) => {
  if (!value) return 0.02;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return 0.02;
  return parsed;
};

export default Sentry.withSentry<Env>(
  (env) => {
    if (!env.SENTRY_DSN) return undefined;

    return {
      dsn: env.SENTRY_DSN,
      environment: env.SENTRY_ENVIRONMENT ?? "production",
      release: env.SENTRY_RELEASE,
      tracesSampleRate: parseSampleRate(env.SENTRY_TRACES_SAMPLE_RATE),
      initialScope: {
        tags: {
          service: "assistant-mk1",
          "runtime.surface": "cloudflare-worker",
          "runtime.target": "control-plane",
        },
      },
    };
  },
  {
    async fetch(request: Request, env: Env, ctx: WorkerExecutionContext) {
      try {
        return await handleRequest(request, env, ctx);
      } catch (error) {
        Sentry.captureException(error);
        return internalErrorResponse("Unhandled control-plane error", error);
      }
    },
  },
);
