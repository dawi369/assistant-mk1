import {
  createChatIntent,
  createChatPolicyDecision,
  createChatRun,
  createChatSession,
  getLatestChatIntent,
  getLatestChatPolicyDecision,
  getLatestChatRun,
  getLatestChatSession,
  getLatestRunningChatRun,
  getOwnedChatSession,
  getOwnedChatThread,
  storeChatThread,
  toChatIntentSnapshot,
  toChatPolicyDecisionSnapshot,
  toChatRunSnapshot,
  toChatSessionSnapshot,
  toChatThreadSnapshot,
  touchChatSession,
  touchChatThread,
  updateChatRun,
} from "./chat-boundary-store";
import { deriveChatExecutionMode, evaluateChatRunPolicy } from "./chat-policy";
import { appendControlPlaneEvent } from "./control-plane-events";
import { isRecord, json, parseJson } from "./http";
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

const summarizeChatRunRequest = (
  body: unknown,
  input: { bodyBytes: number; requestedExecutionMode?: string },
) => {
  if (!isRecord(body)) {
    return {
      bodyBytes: input.bodyBytes,
      requestedExecutionMode: input.requestedExecutionMode,
    };
  }

  const requestInput = isRecord(body.input) ? body.input : {};
  const messages = Array.isArray(requestInput.messages) ? requestInput.messages : [];
  return {
    assistantId: typeof body.assistant_id === "string" ? body.assistant_id : undefined,
    streamMode:
      typeof body.stream_mode === "string" || Array.isArray(body.stream_mode)
        ? body.stream_mode
        : undefined,
    messageCount: messages.length,
    bodyBytes: input.bodyBytes,
    requestedExecutionMode: input.requestedExecutionMode,
  };
};

const parseSseMetadata = (chunk: string) => {
  const metadata = [...chunk.matchAll(/^event: metadata\r?\ndata: (.+)$/gm)]
    .map((match) => parseJson(match[1] ?? ""))
    .find(isRecord);
  const upstreamRunId = metadata?.run_id;
  return {
    metadata,
    upstreamRunId: typeof upstreamRunId === "string" ? upstreamRunId : undefined,
  };
};

const trackStreamRun = async (
  env: Env,
  identity: AgentIdentity,
  threadId: string,
  runId: string,
  body: ReadableStream<Uint8Array> | null,
) => {
  if (!body) {
    await updateChatRun(env, {
      runId,
      scope: identity.scope,
      status: "completed",
      metadata: { stream: "empty" },
    });
    await appendControlPlaneEvent(env, identity, {
      type: "chat.run.completed",
      summary: "Chat run completed with an empty upstream stream.",
      targetType: "chat_run",
      targetId: runId,
      data: { threadId, stream: "empty" },
    });
    return;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let upstreamRunId: string | undefined;
  let metadata: Record<string, unknown> = {};

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer = `${buffer}${decoder.decode(value, { stream: true })}`;
      const parsed = parseSseMetadata(buffer);
      if (parsed.upstreamRunId) upstreamRunId = parsed.upstreamRunId;
      if (parsed.metadata) metadata = parsed.metadata;
      if (buffer.length > 8192) buffer = buffer.slice(-4096);
    }

    const parsed = parseSseMetadata(`${buffer}${decoder.decode()}`);
    if (parsed.upstreamRunId) upstreamRunId = parsed.upstreamRunId;
    if (parsed.metadata) metadata = parsed.metadata;

    await updateChatRun(env, {
      runId,
      scope: identity.scope,
      status: "completed",
      upstreamRunId,
      metadata,
    });
    await appendControlPlaneEvent(env, identity, {
      type: "chat.run.completed",
      summary: "Chat run completed.",
      targetType: "chat_run",
      targetId: runId,
      data: { threadId, upstreamRunId },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown chat stream tracking failure";
    await updateChatRun(env, {
      runId,
      scope: identity.scope,
      status: "failed",
      upstreamRunId,
      metadata,
      error: message,
    });
    await appendControlPlaneEvent(env, identity, {
      type: "chat.run.failed",
      summary: "Chat run tracking failed.",
      targetType: "chat_run",
      targetId: runId,
      data: { threadId, upstreamRunId, error: message },
    });
  }
};

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

const handleCreateThread = async (
  request: Request,
  env: Env,
  url: URL,
  identity: AgentIdentity,
  config: { baseUrl: string; token: string },
) => {
  const upstream = await fetchUpstream(request, env, url, config);
  const headers = responseHeaders(upstream);
  const body = await upstream.text();

  if (!upstream.ok) {
    return new Response(body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  }

  const parsed = parseJson(body);
  if (!isRecord(parsed) || typeof parsed.thread_id !== "string") {
    return json(
      { ok: false, error: "LangGraph upstream did not return a thread_id" },
      { status: 502 },
    );
  }

  const existingSession = await getLatestChatSession(env, identity.scope);
  const createdSession = !existingSession;
  const resolvedSessionId =
    existingSession?.session_id ??
    (await createChatSession(env, identity, { source: "langgraph-facade" }));
  if (createdSession) {
    await appendControlPlaneEvent(env, identity, {
      type: "chat.session.created",
      summary: "Created chat session for LangGraph thread ownership.",
      targetType: "chat_session",
      targetId: resolvedSessionId,
      data: { source: "langgraph-facade" },
    });
  }
  await storeChatThread(env, identity, resolvedSessionId, parsed.thread_id, parsed);
  await appendControlPlaneEvent(env, identity, {
    type: "chat.thread.created",
    summary: "Registered LangGraph thread ownership in Cloudflare.",
    targetType: "chat_thread",
    targetId: parsed.thread_id,
    data: { sessionId: resolvedSessionId },
  });
  await touchChatSession(env, identity.scope, resolvedSessionId, parsed.thread_id);

  return new Response(body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
};

export const handleLangGraphFacade = async (
  request: Request,
  env: Env,
  ctx: WorkerExecutionContext,
  identity: AgentIdentity,
  url: URL,
) => {
  if (!allowedMethods.has(request.method)) {
    return json({ ok: false, error: "method not allowed" }, { status: 405 });
  }

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-headers": "*",
        "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "access-control-allow-origin": "*",
      },
    });
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

  if (isCreateThreadRequest(request, url.pathname)) {
    return handleCreateThread(request, env, url, identity, config);
  }

  const threadId = threadScopedPath(url.pathname);
  const thread = threadId ? await getOwnedChatThread(env, identity.scope, threadId) : null;
  if (threadId) {
    if (!thread) return json({ ok: false, error: "Thread not found" }, { status: 404 });
    await touchChatThread(env, identity.scope, threadId);
    await touchChatSession(env, identity.scope, thread.session_id, threadId);
  }

  if (threadId && thread && isThreadRunStreamRequest(request, url.pathname)) {
    const bodyText = await request.text();
    const parsedBody = parseJson(bodyText);
    const { executionMode, invalidExecutionMode, requestedExecutionMode } =
      deriveChatExecutionMode(parsedBody);
    const runningRun = await getLatestRunningChatRun(env, identity.scope, threadId);
    const policy = evaluateChatRunPolicy({
      executionMode,
      invalidExecutionMode,
      runningRun,
    });
    const payload = summarizeChatRunRequest(parsedBody, {
      bodyBytes: bodyText.length,
      requestedExecutionMode,
    });
    const intentId = await createChatIntent(env, identity, {
      sessionId: thread.session_id,
      threadId,
      executionMode,
      status: policy.decision === "allow" ? "allowed" : "blocked",
      payload,
    });
    await appendControlPlaneEvent(env, identity, {
      type: "chat.intent.created",
      summary: "Created chat response intent.",
      targetType: "chat_intent",
      targetId: intentId,
      data: { threadId, sessionId: thread.session_id, executionMode, status: policy.decision },
    });
    const policyDecisionId = await createChatPolicyDecision(env, identity, {
      intentId,
      threadId,
      decision: policy.decision,
      reason: policy.reason,
      executionMode,
      limits: { sameThreadConcurrency: 1 },
    });
    await appendControlPlaneEvent(env, identity, {
      type: policy.decision === "allow" ? "chat.policy.allowed" : "chat.policy.blocked",
      summary: policy.reason,
      targetType: "chat_policy_decision",
      targetId: policyDecisionId,
      data: { threadId, intentId, executionMode },
    });

    if (policy.decision === "block") {
      return json(
        {
          ok: false,
          error: policy.reason,
          intentId,
          policyDecisionId,
          decision: policy.decision,
        },
        { status: policy.status },
      );
    }

    const runId = await createChatRun(env, identity, {
      threadId,
      intentId,
      policyDecisionId,
      metadata: { executionMode },
    });
    await appendControlPlaneEvent(env, identity, {
      type: "chat.run.started",
      summary: "Started Cloudflare-gated chat run.",
      targetType: "chat_run",
      targetId: runId,
      data: { threadId, intentId, policyDecisionId, executionMode },
    });
    const upstream = await fetchUpstream(request, env, url, config, bodyText);

    if (!upstream.ok) {
      const error = `${upstream.status} ${upstream.statusText}`;
      await updateChatRun(env, {
        runId,
        scope: identity.scope,
        status: "failed",
        error,
      });
      await appendControlPlaneEvent(env, identity, {
        type: "chat.run.failed",
        summary: "Chat run failed before upstream stream tracking started.",
        targetType: "chat_run",
        targetId: runId,
        data: { threadId, error },
      });
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders(upstream),
      });
    }

    if (upstream.body) {
      const [clientBody, trackingBody] = upstream.body.tee();
      ctx.waitUntil(trackStreamRun(env, identity, threadId, runId, trackingBody));
      return new Response(clientBody, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders(upstream),
      });
    }

    await updateChatRun(env, {
      runId,
      scope: identity.scope,
      status: upstream.ok ? "completed" : "failed",
      error: upstream.ok ? undefined : `${upstream.status} ${upstream.statusText}`,
    });
    await appendControlPlaneEvent(env, identity, {
      type: upstream.ok ? "chat.run.completed" : "chat.run.failed",
      summary: upstream.ok
        ? "Chat run completed without an upstream response body."
        : "Chat run failed without an upstream response body.",
      targetType: "chat_run",
      targetId: runId,
      data: { threadId },
    });

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders(upstream),
    });
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
  const sessionId = await createChatSession(env, identity, metadata);
  await appendControlPlaneEvent(env, identity, {
    type: "chat.session.created",
    summary: "Created chat session.",
    targetType: "chat_session",
    targetId: sessionId,
    data: { source: "sessions-api" },
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
