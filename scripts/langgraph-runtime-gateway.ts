import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

import {
  executeDemoInspectExecutorRequest,
  type DemoInspectExecutorRequest,
  validateDemoInspectExecutorRequest,
} from "../lib/workbench/demo-inspect-executor";

const port = Number(process.env.PORT ?? 3000);
const langGraphUpstreamUrl = (
  process.env.LANGGRAPH_UPSTREAM_URL ?? "http://127.0.0.1:2024"
).replace(/\/$/, "");

const json = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
};

const readBody = async (request: IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};

const readJsonBody = async <T>(request: IncomingMessage): Promise<T | null> => {
  const body = await readBody(request);
  if (body.length === 0) return null;

  try {
    return JSON.parse(body.toString("utf8")) as T;
  } catch {
    return null;
  }
};

const bearerToken = (value: string) => `Bearer ${value}`;

const isAuthorized = (request: IncomingMessage, token: string) => {
  return (
    request.headers["x-api-key"] === token || request.headers.authorization === bearerToken(token)
  );
};

const requireProxyAuth = (request: IncomingMessage, response: ServerResponse) => {
  const token = process.env.LANGGRAPH_PROXY_TOKEN;
  if (!token) {
    json(response, 500, { ok: false, error: "LANGGRAPH_PROXY_TOKEN is not configured" });
    return false;
  }

  if (!isAuthorized(request, token)) {
    json(response, 401, { ok: false, error: "unauthorized" });
    return false;
  }

  return true;
};

const requireExecutorAuth = (request: IncomingMessage, response: ServerResponse) => {
  const token = process.env.WORKBENCH_EXECUTOR_TOKEN;
  if (!token) {
    json(response, 500, { ok: false, error: "WORKBENCH_EXECUTOR_TOKEN is not configured" });
    return false;
  }

  if (request.headers.authorization !== bearerToken(token)) {
    json(response, 401, { ok: false, error: "unauthorized" });
    return false;
  }

  return true;
};

const isLangGraphReady = async () => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 750);

  try {
    const response = await fetch(`${langGraphUpstreamUrl}/ok`, {
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
};

const handleDemoInspectExecutor = async (request: IncomingMessage, response: ServerResponse) => {
  if (request.method !== "POST") {
    json(response, 405, { ok: false, error: "method not allowed" });
    return;
  }
  if (!requireExecutorAuth(request, response)) return;

  const body = await readJsonBody<DemoInspectExecutorRequest>(request);
  if (!body) {
    json(response, 400, { ok: false, error: "request body must be JSON" });
    return;
  }

  const parsed = validateDemoInspectExecutorRequest(body);
  if (!parsed.ok) {
    json(response, 400, { ok: false, error: parsed.error });
    return;
  }

  json(response, 200, await executeDemoInspectExecutorRequest(parsed.request));
};

const headersToForward = (request: IncomingMessage) => {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (!value || key === "host" || key === "content-length") continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.set(key, value);
    }
  }
  headers.delete("x-api-key");
  headers.delete("authorization");
  return headers;
};

const proxyToLangGraph = async (request: IncomingMessage, response: ServerResponse, url: URL) => {
  if (!requireProxyAuth(request, response)) return;

  const method = request.method ?? "GET";
  const body = ["GET", "HEAD"].includes(method) ? undefined : await readBody(request);
  const upstreamResponse = await fetch(`${langGraphUpstreamUrl}${url.pathname}${url.search}`, {
    method,
    headers: headersToForward(request),
    body,
  });

  const responseHeaders = new Headers(upstreamResponse.headers);
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");
  responseHeaders.delete("transfer-encoding");

  response.writeHead(upstreamResponse.status, Object.fromEntries(responseHeaders.entries()));
  if (upstreamResponse.body) {
    Readable.fromWeb(upstreamResponse.body as unknown as NodeReadableStream).pipe(response);
    return;
  }
  response.end();
};

const server = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (request.method === "GET" && url.pathname === "/health") {
      const langGraphReady = await isLangGraphReady();
      json(response, langGraphReady ? 200 : 503, {
        ok: langGraphReady,
        service: "assistant-mk1-langgraph-runtime",
        langGraphUpstreamUrl,
        langGraphReady,
      });
      return;
    }

    if (url.pathname === "/workbench/executors/demo-inspect") {
      await handleDemoInspectExecutor(request, response);
      return;
    }

    await proxyToLangGraph(request, response, url);
  })().catch((error: unknown) => {
    json(response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : "runtime gateway request failed",
    });
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`LangGraph runtime gateway listening on ${port}`);
});
