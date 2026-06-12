import { internalErrorResponse, json } from "./http";
import { sessionCoordinatorName } from "./session-coordinator";
import type { AgentIdentity, Env } from "./types";

type SessionAction = "get" | "create" | "activate";

const agentHostFromRequest = (request: Request) => {
  const url = new URL(request.url);
  return url.origin;
};

const coordinatorResponse = async (
  request: Request,
  env: Env,
  identity: AgentIdentity,
  input: { action: SessionAction | "stream"; threadId?: string; refresh?: "threads" },
) => {
  if (!env.WorkbenchSessionAgent) {
    return internalErrorResponse(
      "WorkbenchSessionAgent binding is not configured",
      new Error("WorkbenchSessionAgent binding is not configured"),
    );
  }

  const name = await sessionCoordinatorName(identity);
  const stub = env.WorkbenchSessionAgent.get(env.WorkbenchSessionAgent.idFromName(name));
  const response = await stub.fetch("https://session-agent.internal/session", {
    method: "POST",
    body: JSON.stringify({
      action: input.action,
      identity,
      threadId: input.threadId,
      refresh: input.refresh,
      agentHost: agentHostFromRequest(request),
    }),
  });
  const body = await response.text();
  return new Response(body, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") ?? "application/json; charset=utf-8",
    },
  });
};

export const handleChatSession = async (request: Request, env: Env, identity: AgentIdentity) =>
  coordinatorResponse(request, env, identity, {
    action: "get",
    refresh: new URL(request.url).searchParams.get("refresh") === "threads" ? "threads" : undefined,
  });

export const handleChatSessionStream = async (
  request: Request,
  env: Env,
  identity: AgentIdentity,
) => {
  if (!env.WorkbenchSessionAgent) {
    return internalErrorResponse(
      "WorkbenchSessionAgent binding is not configured",
      new Error("WorkbenchSessionAgent binding is not configured"),
    );
  }

  const name = await sessionCoordinatorName(identity);
  const stub = env.WorkbenchSessionAgent.get(env.WorkbenchSessionAgent.idFromName(name));
  const response = await stub.fetch("https://session-agent.internal/session", {
    method: "POST",
    body: JSON.stringify({
      action: "stream",
      identity,
      agentHost: agentHostFromRequest(request),
    }),
  });
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: {
      "content-type": response.headers.get("content-type") ?? "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
};

export const handleCreateChatSessionThread = async (
  request: Request,
  env: Env,
  identity: AgentIdentity,
) => coordinatorResponse(request, env, identity, { action: "create" });

export const handleActivateChatSessionThread = async (
  request: Request,
  env: Env,
  identity: AgentIdentity,
  threadId: string,
) => {
  if (!threadId.trim()) return json({ ok: false, error: "threadId is required" }, { status: 400 });
  return coordinatorResponse(request, env, identity, { action: "activate", threadId });
};
