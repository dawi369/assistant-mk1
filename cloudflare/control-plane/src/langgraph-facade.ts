import {
  createChatRun,
  getLatestChatRun,
  getOwnedChatThread,
  storeChatThread,
  toChatRunSnapshot,
  toChatThreadSnapshot,
  touchChatThread,
  updateChatRun,
} from "./chat-boundary-store";
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
  } catch (error) {
    await updateChatRun(env, {
      runId,
      scope: identity.scope,
      status: "failed",
      upstreamRunId,
      metadata,
      error: error instanceof Error ? error.message : "Unknown chat stream tracking failure",
    });
  }
};

const fetchUpstream = (
  request: Request,
  env: Env,
  url: URL,
  config: { baseUrl: string; token: string },
) => {
  const upstreamPath = stripLangGraphPrefix(url.pathname);
  return fetch(`${config.baseUrl}${upstreamPath}${url.search}`, {
    method: request.method,
    headers: headersForUpstream(request, config.token),
    body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
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

  await storeChatThread(env, identity, parsed.thread_id, parsed);

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
  if (threadId) {
    const thread = await getOwnedChatThread(env, identity.scope, threadId);
    if (!thread) return json({ ok: false, error: "Thread not found" }, { status: 404 });
    await touchChatThread(env, identity.scope, threadId);
  }

  const runId =
    threadId && isThreadRunStreamRequest(request, url.pathname)
      ? await createChatRun(env, identity, threadId)
      : null;

  const upstream = await fetchUpstream(request, env, url, config);

  if (runId && !upstream.ok) {
    await updateChatRun(env, {
      runId,
      scope: identity.scope,
      status: "failed",
      error: `${upstream.status} ${upstream.statusText}`,
    });
  }

  if (runId && upstream.body) {
    const [clientBody, trackingBody] = upstream.body.tee();
    ctx.waitUntil(trackStreamRun(env, identity, runId, trackingBody));
    return new Response(clientBody, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders(upstream),
    });
  }

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

  const latestRun = await getLatestChatRun(env, identity.scope, threadId);
  return json({
    ok: true,
    thread: toChatThreadSnapshot(thread),
    latestRun: toChatRunSnapshot(latestRun),
  });
};
