/**
 * Catch-all proxy from the Next app to the LangGraph API server.
 *
 * assistant-ui and the LangGraph SDK can call `/api/...` in the browser while
 * this route forwards the request to `LANGGRAPH_API_URL`. The bracketed route
 * segment is Next.js catch-all syntax, not a product-specific endpoint name.
 */
import { type NextRequest, NextResponse } from "next/server";

import { toWorkbenchApiError } from "@/lib/workbench/api-errors";
import { getWorkbenchIdentityHeaders } from "@/lib/workbench/agent-identity";

export const runtime = "nodejs";

function getAllowedOrigin(requestOrigin: string | null) {
  const allowed = process.env.ALLOWED_ORIGINS?.split(",").map((s) => s.trim());
  if (!allowed || allowed.length === 0) return null;
  if (allowed.includes("*")) return "*";
  if (requestOrigin && allowed.includes(requestOrigin)) return requestOrigin;
  return null;
}

function getCorsHeaders(requestOrigin: string | null = null) {
  const origin = getAllowedOrigin(requestOrigin);
  if (!origin) {
    return {
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, authorization, x-api-key",
    };
  }
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization, x-api-key",
    ...(origin !== "*" && { Vary: "Origin" }),
  };
}

const requiredEnv = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
};

const proxyHeaders = async (trace: {
  traceId: string;
  startedAtMs: number;
  durationMs: number;
}) => {
  const headers: Record<string, string> = {};
  headers["x-assistant-mk1-trace-id"] = trace.traceId;
  headers["x-assistant-mk1-vercel-started-at"] = String(trace.startedAtMs);
  headers["x-assistant-mk1-vercel-duration-ms"] = String(trace.durationMs);

  if (process.env.CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN) {
    headers.authorization = `Bearer ${requiredEnv("CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN")}`;
    Object.assign(headers, await getWorkbenchIdentityHeaders());
    return headers;
  }

  if (process.env.LANGCHAIN_API_KEY) {
    headers["x-api-key"] = process.env.LANGCHAIN_API_KEY;
  }

  return headers;
};

async function handleRequest(req: NextRequest, method: string) {
  const requestOrigin = req.headers.get("origin");
  const proxyStartedAtMs = Date.now();
  const traceId = `trace-${crypto.randomUUID()}`;
  try {
    const apiUrl = requiredEnv("LANGGRAPH_API_URL").replace(/\/$/, "");
    const path = req.nextUrl.pathname.replace(/^\/?api\//, "");
    const url = new URL(req.url);
    const searchParams = new URLSearchParams(url.search);
    searchParams.delete("_path");
    searchParams.delete("nxtP_path");
    const queryString = searchParams.toString() ? `?${searchParams.toString()}` : "";

    const requestHeaders: Record<string, string> = {};
    let body: string | undefined;
    if (["POST", "PUT", "PATCH"].includes(method)) {
      const contentType = req.headers.get("content-type");
      if (contentType) {
        requestHeaders["content-type"] = contentType;
      }
      body = await req.text();
    }

    Object.assign(
      requestHeaders,
      await proxyHeaders({
        traceId,
        startedAtMs: proxyStartedAtMs,
        durationMs: Date.now() - proxyStartedAtMs,
      }),
    );
    const options: RequestInit = {
      method,
      headers: requestHeaders,
      signal: req.signal,
      body,
    };

    const res = await fetch(`${apiUrl}/${path}${queryString}`, options);

    const responseHeaders = new Headers(res.headers);
    responseHeaders.set("x-assistant-mk1-trace-id", traceId);
    responseHeaders.delete("content-encoding");
    responseHeaders.delete("content-length");
    responseHeaders.delete("transfer-encoding");
    const corsHeaders = getCorsHeaders(requestOrigin);
    for (const [key, value] of Object.entries(corsHeaders)) {
      responseHeaders.set(key, value);
    }

    return new NextResponse(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: responseHeaders,
    });
  } catch (e: unknown) {
    return toWorkbenchApiError(e, "LangGraph proxy request failed");
  }
}

export const GET = (req: NextRequest) => handleRequest(req, "GET");
export const POST = (req: NextRequest) => handleRequest(req, "POST");
export const PUT = (req: NextRequest) => handleRequest(req, "PUT");
export const PATCH = (req: NextRequest) => handleRequest(req, "PATCH");
export const DELETE = (req: NextRequest) => handleRequest(req, "DELETE");
export const OPTIONS = (req: NextRequest) =>
  new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(req.headers.get("origin")),
  });
