import {
  createChatSession,
  getLatestChatIntent,
  getLatestChatPolicyDecision,
  getLatestChatRun,
  getLatestChatSession,
  getOwnedChatSession,
  getOwnedChatThread,
  toChatIntentSnapshot,
  toChatPolicyDecisionSnapshot,
  toChatRunSnapshot,
  toChatSessionSnapshot,
  toChatThreadSnapshot,
  touchChatSession,
  touchChatThread,
} from "./chat-boundary-store";
import { toAgentRuntimeMetadata } from "./agent-records";
import {
  handleCloudflareCreateThread,
  handleCloudflareRunStream,
  handleCloudflareThreadState,
} from "./cloudflare-chat-runtime";
import { appendControlPlaneEvent } from "./control-plane-events";
import { selectAgent } from "./authz-store";
import { isRecord, json, parseJson } from "./http";
import type { IncomingRuntimeTrace } from "./runtime-traces";
import type { AgentIdentity, Env, WorkerExecutionContext } from "./types";

const allowedMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

const stripLangGraphPrefix = (pathname: string) => {
  const stripped = pathname.replace(/^\/langgraph\/?/, "/");
  return stripped === "/" ? "/" : stripped;
};

const upstreamConfig = (env: Env) => {
  const baseUrl = env.LANGGRAPH_UPSTREAM_URL?.replace(/\/$/, "");
  const token = env.LANGGRAPH_UPSTREAM_TOKEN;
  return baseUrl && token ? { baseUrl, token } : null;
};

const headersForUpstream = (request: Request, token: string) => {
  const headers = new Headers(request.headers);
  headers.delete("authorization");
  headers.delete("host");
  headers.delete("content-length");
  headers.delete("x-api-key");
  headers.delete("x-assistant-mk1-user-id");
  headers.delete("x-assistant-mk1-workspace-id");
  headers.delete("x-assistant-mk1-agent-id");
  headers.set("x-api-key", token);
  return headers;
};

const responseHeaders = (upstream: Response) => {
  const headers = new Headers(upstream.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  return headers;
};

const threadScopedPath = (pathname: string) => {
  const match = pathname.match(/^\/langgraph\/threads\/([^/]+)(?:\/.*)?$/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
};

const isCreateThreadRequest = (request: Request, pathname: string) =>
  request.method === "POST" && pathname === "/langgraph/threads";

const isThreadRunStreamRequest = (request: Request, pathname: string) =>
  request.method === "POST" && /^\/langgraph\/threads\/[^/]+\/runs\/stream$/.test(pathname);

const isThreadStateRequest = (request: Request, pathname: string) =>
  request.method === "GET" && /^\/langgraph\/threads\/[^/]+\/state$/.test(pathname);

const fetchUpstream = (
  request: Request,
  env: Env,
  url: URL,
  config: { baseUrl: string; token: string },
  bodyOverride?: BodyInit | null,
) => {
  const upstreamPath = stripLangGraphPrefix(url.pathname);
  return fetch(`${config.baseUrl}${upstreamPath}${url.search}`, {
    method: request.method,
    headers: headersForUpstream(request, config.token),
    body: ["GET", "HEAD"].includes(request.method)
      ? undefined
      : bodyOverride === undefined
        ? request.body
        : bodyOverride,
  });
};

export const handleLangGraphFacade = async (
  request: Request,
  env: Env,
  ctx: WorkerExecutionContext,
  identity: AgentIdentity,
  url: URL,
  incomingTrace?: IncomingRuntimeTrace,
) => {
  if (!allowedMethods.has(request.method)) {
    return json({ ok: false, error: "method not allowed" }, { status: 405 });
  }

  if (request.method === "OPTIONS") {
    const requestOrigin = request.headers.get("origin");
    const allowedOrigins = env.ALLOWED_ORIGINS?.split(",").map((s: string) => s.trim());
    const origin = allowedOrigins?.includes("*")
      ? "*"
      : requestOrigin && allowedOrigins?.includes(requestOrigin)
        ? requestOrigin
        : null;
    const headers: Record<string, string> = {
      "access-control-allow-headers": "content-type, authorization, x-api-key",
      "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    };
    if (origin) headers["access-control-allow-origin"] = origin;
    if (origin && origin !== "*") headers["vary"] = "Origin";
    return new Response(null, { status: 204, headers });
  }

  if (isCreateThreadRequest(request, url.pathname)) {
    return handleCloudflareCreateThread(env, identity, incomingTrace);
  }

  const threadId = threadScopedPath(url.pathname);
  const threadOwnershipStartedAtMs = threadId ? Date.now() : null;
  const thread = threadId ? await getOwnedChatThread(env, identity.scope, threadId) : null;
  const threadOwnershipEndedAtMs = threadId ? Date.now() : null;
  const scopedIncomingTrace = incomingTrace
    ? {
        ...incomingTrace,
        threadOwnershipStartedAtMs,
        threadOwnershipEndedAtMs,
      }
    : undefined;
  if (threadId) {
    if (!thread) return json({ ok: false, error: "Thread not found" }, { status: 404 });
    await touchChatThread(env, identity.scope, threadId);
    await touchChatSession(env, identity.scope, thread.session_id, threadId);
  }

  if (threadId && thread && isThreadStateRequest(request, url.pathname)) {
    return handleCloudflareThreadState(thread);
  }

  if (threadId && thread && isThreadRunStreamRequest(request, url.pathname)) {
    const facadeEnteredAtMs = Date.now();
    const bodyText = await request.text();
    return handleCloudflareRunStream(
      env,
      identity,
      thread,
      bodyText,
      ctx,
      {
        facadeEnteredAtMs,
        bodyReadAtMs: Date.now(),
      },
      scopedIncomingTrace,
    );
  }

  const config = upstreamConfig(env);
  if (!config) {
    return json(
      {
        ok: false,
        error: "LANGGRAPH_UPSTREAM_URL and LANGGRAPH_UPSTREAM_TOKEN are required",
      },
      { status: 500 },
    );
  }

  const upstream = await fetchUpstream(request, env, url, config);

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders(upstream),
  });
};

export const handleChatBoundarySnapshot = async (
  env: Env,
  identity: AgentIdentity,
  threadId: string,
) => {
  const thread = await getOwnedChatThread(env, identity.scope, threadId);
  if (!thread) return json({ ok: false, error: "Thread not found" }, { status: 404 });

  const session = await getOwnedChatSession(env, identity.scope, thread.session_id);
  const latestRun = await getLatestChatRun(env, identity.scope, threadId);
  const latestIntent = await getLatestChatIntent(env, identity.scope, threadId);
  const latestPolicyDecision = await getLatestChatPolicyDecision(env, identity.scope, threadId);
  return json({
    ok: true,
    session: toChatSessionSnapshot(session),
    thread: toChatThreadSnapshot(thread),
    latestIntent: toChatIntentSnapshot(latestIntent),
    latestPolicyDecision: toChatPolicyDecisionSnapshot(latestPolicyDecision),
    latestRun: toChatRunSnapshot(latestRun),
  });
};

export const handleCreateChatSession = async (
  request: Request,
  env: Env,
  identity: AgentIdentity,
) => {
  const raw = await request.text();
  const parsed = raw ? parseJson(raw) : null;
  const metadata = isRecord(parsed) && isRecord(parsed.metadata) ? parsed.metadata : {};
  const activeAgent = await selectAgent(env, identity.agentId, identity.scope.workspaceId);
  const agentMetadata = toAgentRuntimeMetadata(env, activeAgent, identity.agentId);
  const sessionId = await createChatSession(env, identity, {
    ...metadata,
    agent: agentMetadata,
  });
  await appendControlPlaneEvent(env, identity, {
    type: "chat.session.created",
    summary: "Created chat session.",
    targetType: "chat_session",
    targetId: sessionId,
    data: { source: "sessions-api", agent: agentMetadata },
  });
  const session = await getOwnedChatSession(env, identity.scope, sessionId);
  return json({ ok: true, session: toChatSessionSnapshot(session) }, { status: 201 });
};

export const handleLatestChatSession = async (env: Env, identity: AgentIdentity) => {
  const session = await getLatestChatSession(env, identity.scope);
  return json({ ok: true, session: toChatSessionSnapshot(session) });
};

export const handleGetChatSession = async (
  env: Env,
  identity: AgentIdentity,
  sessionId: string,
) => {
  const session = await getOwnedChatSession(env, identity.scope, sessionId);
  if (!session) return json({ ok: false, error: "Session not found" }, { status: 404 });
  return json({ ok: true, session: toChatSessionSnapshot(session) });
};
