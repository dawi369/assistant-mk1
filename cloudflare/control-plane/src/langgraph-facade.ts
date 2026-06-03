import { json } from "./http";
import type { Env } from "./types";

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

export const handleLangGraphFacade = async (request: Request, env: Env, url: URL) => {
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

  const upstreamPath = stripLangGraphPrefix(url.pathname);
  const upstream = await fetch(`${config.baseUrl}${upstreamPath}${url.search}`, {
    method: request.method,
    headers: headersForUpstream(request, config.token),
    body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
  });

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders(upstream),
  });
};
