import type { Id } from "@/lib/agent-framework/contracts";
import { getWorkbenchIdentityHeaders } from "@/lib/workbench/agent-identity";
import {
  adminSummaryProjectionPath,
  type AdminSummaryProjection,
} from "@/lib/workbench/admin-summary-projection";
import { signFacadeRequest } from "@/lib/workbench/control-plane-signing";
import type {
  AgentSummary,
  CloudflareAgentBehaviorTemplatesResponse,
  CloudflareAdminSummaryResponse,
  CloudflareAgentMutationResponse,
  CloudflareAgentsResponse,
  CloudflareRuntimeTraceResponse,
  CloudflareRuntimeTracesResponse,
  CloudflareToolPolicyUpdateResponse,
  CloudflareToolApprovalActionResponse,
  CloudflareToolApprovalsResponse,
  CloudflareToolRunResponse,
  CloudflareToolsResponse,
  CloudflareOwnedDemoRunResponse,
  CloudflareWorkspaceMutationResponse,
  CloudflareWorkspacesResponse,
  ChatThreadResponse,
  ChatThreadStatus,
  ChatThreadsResponse,
  ChatSessionResponse,
  ChatRuntimeSummaryResponse,
  CloudflareArtifactHistoryResponse,
  CloudflareExecutionHistoryResponse,
  CloudflareExecutionHistoryRunResponse,
  ControlPlaneEventsResponse,
  WorkspaceContextResponse,
} from "@/lib/workbench/workbench-types";

export type {
  CloudflareAgentBehaviorTemplatesResponse,
  CloudflareAdminSummaryResponse,
  CloudflareAgentMutationResponse,
  CloudflareAgentsResponse,
  CloudflareRuntimeTraceResponse,
  CloudflareRuntimeTracesResponse,
  CloudflareToolPolicyUpdateResponse,
  CloudflareToolApprovalActionResponse,
  CloudflareToolApprovalsResponse,
  CloudflareToolRunResponse,
  CloudflareToolsResponse,
  CloudflareOwnedDemoRunResponse,
  CloudflareOwnedDemoRunSnapshot,
  CloudflareWorkspaceMutationResponse,
  CloudflareWorkspacesResponse,
  ChatRuntimeSummary,
  ChatRuntimeSummaryResponse,
  ChatSessionResponse,
  ChatThreadResponse,
  ChatThreadsResponse,
  ChatThreadSummary,
  CloudflareArtifactHistoryResponse,
  CloudflareExecutionHistoryResponse,
  CloudflareExecutionHistoryRunResponse,
  ControlPlaneEvent,
  ControlPlaneEventsResponse,
  ExecutionHistoryRunSummary,
  ToolApprovalRequestSummary,
  WorkspaceContextResponse,
} from "@/lib/workbench/workbench-types";

export class ControlPlaneRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ControlPlaneRequestError";
  }
}

const requestTimeoutMs = 10_000;

const getControlPlaneConfig = () => {
  const baseUrl = process.env.CLOUDFLARE_CONTROL_PLANE_URL?.replace(/\/$/, "");
  const token = process.env.CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN;
  const signingSecret = process.env.CLOUDFLARE_CONTROL_PLANE_FACADE_SIGNING_SECRET;
  return baseUrl && token ? { baseUrl, token, signingSecret } : null;
};

const fetchWithTimeout = async (url: string, init: RequestInit) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ControlPlaneRequestError(
        `Cloudflare control-plane request timed out after ${requestTimeoutMs}ms`,
        504,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const controlPlaneRequest = async (path: string, init?: RequestInit) => {
  const config = getControlPlaneConfig();
  if (!config) {
    throw new Error(
      "CLOUDFLARE_CONTROL_PLANE_URL and CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN are required",
    );
  }
  const identityHeaders = await getWorkbenchIdentityHeaders();
  const method = init?.method ?? "GET";
  const body = typeof init?.body === "string" ? init.body : "";
  const headers: Record<string, string> = {
    authorization: `Bearer ${config.token}`,
    "content-type": "application/json",
    ...identityHeaders,
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (config.signingSecret?.trim()) {
    Object.assign(
      headers,
      await signFacadeRequest({
        secret: config.signingSecret,
        method,
        pathWithQuery: path,
        body,
        headers,
      }),
    );
  }

  return {
    url: `${config.baseUrl}${path}`,
    init: {
      ...init,
      headers,
    } satisfies RequestInit,
  };
};

const parseErrorBody = async (response: Response) => {
  const body = await response.text();
  if (!body) return response.statusText;

  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    return typeof parsed.error === "string" ? parsed.error : body;
  } catch {
    return body;
  }
};

const requestControlPlane = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const request = await controlPlaneRequest(path, init);
  const response = await fetchWithTimeout(request.url, request.init);

  if (!response.ok) {
    throw new ControlPlaneRequestError(await parseErrorBody(response), response.status);
  }

  return (await response.json()) as T;
};

export const startCloudflareOwnedDemoRun = () =>
  requestControlPlane<CloudflareOwnedDemoRunResponse>("/workbench/demo-runs", {
    method: "POST",
  });

export const getLatestCloudflareOwnedDemoRunSnapshot = () =>
  requestControlPlane<CloudflareOwnedDemoRunResponse>("/workbench/demo-runs/latest");

export const getCloudflareOwnedDemoRunSnapshot = (runId: Id) =>
  requestControlPlane<CloudflareOwnedDemoRunResponse>(
    `/workbench/demo-runs/${encodeURIComponent(runId)}`,
  );

export const getWorkspaceContext = () =>
  requestControlPlane<WorkspaceContextResponse>("/workspace-context");

export const getCloudflareAdminSummary = (input?: { projection?: AdminSummaryProjection }) =>
  requestControlPlane<CloudflareAdminSummaryResponse>(
    adminSummaryProjectionPath(input?.projection),
  );

export const getCloudflareTools = (input?: {
  stage?: "observe" | "analyze" | "propose" | "execute" | "review";
  executionMode?: "ask" | "dry_run" | "execute";
  surface?: "admin_list" | "admin_run" | "admin_resume" | "model_exposure" | "model_tool_call";
  featureFlags?: string;
}) => {
  const params = new URLSearchParams();
  if (input?.stage) params.set("stage", input.stage);
  if (input?.executionMode) params.set("executionMode", input.executionMode);
  if (input?.surface) params.set("surface", input.surface);
  if (input?.featureFlags) params.set("featureFlags", input.featureFlags);
  const query = params.toString();
  return requestControlPlane<CloudflareToolsResponse>(`/tools${query ? `?${query}` : ""}`);
};

export const getCloudflareToolApprovals = (input?: {
  status?: "requested" | "decided" | "all";
  limit?: number;
}) => {
  const params = new URLSearchParams();
  if (input?.status) params.set("status", input.status);
  if (input?.limit) params.set("limit", String(input.limit));
  const query = params.toString();
  return requestControlPlane<CloudflareToolApprovalsResponse>(
    `/tools/approvals${query ? `?${query}` : ""}`,
  );
};

export const getLatestRuntimeTraces = (limit = 10) =>
  requestControlPlane<CloudflareRuntimeTracesResponse>(
    `/runtime/traces/latest?limit=${encodeURIComponent(String(limit))}`,
  );

export const getRuntimeTrace = (traceId: Id) =>
  requestControlPlane<CloudflareRuntimeTraceResponse>(
    `/runtime/traces/${encodeURIComponent(traceId)}`,
  );

export const getExecutionHistory = (limit = 25) =>
  requestControlPlane<CloudflareExecutionHistoryResponse>(
    `/workbench/history/runs?limit=${encodeURIComponent(String(limit))}`,
  );

export const getExecutionHistoryRun = (runId: Id) =>
  requestControlPlane<CloudflareExecutionHistoryRunResponse>(
    `/workbench/history/runs/${encodeURIComponent(runId)}`,
  );

export const getArtifactHistory = (limit = 25) =>
  requestControlPlane<CloudflareArtifactHistoryResponse>(
    `/workbench/history/artifacts?limit=${encodeURIComponent(String(limit))}`,
  );

export type RunnableAdminToolName =
  | "url.inspect"
  | "repo.snapshot"
  | "diagnostic.ping"
  | "runner.echo"
  | "artifact.metadata.test"
  | "polymarket.market.search"
  | "polymarket.market.snapshot"
  | "polymarket.orderbook.snapshot";

export const runCloudflareTool = (input: {
  toolName: RunnableAdminToolName;
  executionMode?: "dry_run";
  input: { url: string } | Record<string, unknown>;
  parentRunId?: Id;
}) =>
  requestControlPlane<CloudflareToolRunResponse>("/tools/runs", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const runPolymancerMarketResearch = (input: {
  executionMode?: "dry_run";
  input: Record<string, unknown>;
}) =>
  requestControlPlane<CloudflareToolRunResponse & { report?: unknown }>(
    "/workflows/polymancer/market-research",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );

export const updateCloudflareToolPolicy = (input: {
  toolName: "url.inspect" | "repo.snapshot";
  status?: "enabled" | "disabled";
  requiresApproval?: boolean;
  killSwitchReason?: string;
  modelVisible?: boolean;
  approvalReason?: string;
  allowedExecutionModes?: Array<"ask" | "dry_run" | "execute">;
  limits?: {
    perUserPerHour?: number;
    perWorkspacePerHour?: number;
  };
  cooldownSeconds?: number | null;
  allowlist?: string[];
  denylist?: string[];
  maxRuntimeMs?: number | null;
  maxArtifactBytes?: number | null;
}) =>
  requestControlPlane<CloudflareToolPolicyUpdateResponse>("/tools/policy", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const approveCloudflareToolApproval = (approvalRequestId: Id) =>
  requestControlPlane<CloudflareToolApprovalActionResponse>(
    `/tools/approvals/${encodeURIComponent(approvalRequestId)}/approve`,
    {
      method: "POST",
    },
  );

export const denyCloudflareToolApproval = (approvalRequestId: Id, input?: { reason?: string }) =>
  requestControlPlane<CloudflareToolApprovalActionResponse>(
    `/tools/approvals/${encodeURIComponent(approvalRequestId)}/deny`,
    {
      method: "POST",
      body: JSON.stringify(input ?? {}),
    },
  );

export const getChatRuntimeSummary = () =>
  requestControlPlane<ChatRuntimeSummaryResponse>("/chat/runtime-summary");

export const getChatThreads = (limit = 30) =>
  requestControlPlane<ChatThreadsResponse>(`/chat/threads?limit=${encodeURIComponent(limit)}`);

export const getChatThread = (threadId: Id) =>
  requestControlPlane<ChatThreadResponse>(`/chat/threads/${encodeURIComponent(threadId)}`);

export const getChatSession = (input?: { refresh?: "threads" }) =>
  requestControlPlane<ChatSessionResponse>(
    `/chat/session${input?.refresh ? `?refresh=${encodeURIComponent(input.refresh)}` : ""}`,
  );

export const streamChatSessionEvents = async () => {
  const request = await controlPlaneRequest("/chat/session/stream", {
    headers: {
      accept: "text/event-stream",
    },
  });
  const response = await fetch(request.url, request.init);

  if (!response.ok) {
    throw new ControlPlaneRequestError(await parseErrorBody(response), response.status);
  }

  return response;
};

export const createChatSessionThread = (input?: { title?: string }) =>
  requestControlPlane<ChatSessionResponse>("/chat/session/threads", {
    method: "POST",
    body: input?.title ? JSON.stringify({ title: input.title }) : undefined,
  });

export const stageChatSessionThread = () =>
  requestControlPlane<ChatSessionResponse>("/chat/session/stage-thread", {
    method: "POST",
  });

export const materializeChatSessionTurn = (input: { message: string }) =>
  requestControlPlane<ChatSessionResponse>("/chat/session/materialize-turn", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const getChatSessionThreads = (input?: {
  status?: Extract<ChatThreadStatus, "active" | "archived">;
}) =>
  requestControlPlane<ChatThreadsResponse>(
    `/chat/session/threads${input?.status ? `?status=${encodeURIComponent(input.status)}` : ""}`,
  );

export const activateChatSessionThread = (threadId: Id) =>
  requestControlPlane<ChatSessionResponse>(
    `/chat/session/threads/${encodeURIComponent(threadId)}/activate`,
    { method: "POST" },
  );

export const updateChatSessionThread = (
  threadId: Id,
  input: { title?: string; status?: ChatThreadStatus; fallbackTitle?: string },
) =>
  requestControlPlane<ChatSessionResponse>(
    `/chat/session/threads/${encodeURIComponent(threadId)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );

export const getCloudflareWorkspaces = () =>
  requestControlPlane<CloudflareWorkspacesResponse>("/workspaces");

export const createCloudflareWorkspace = (input: { name: string }) =>
  requestControlPlane<CloudflareWorkspaceMutationResponse>("/workspaces", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const activateCloudflareWorkspace = (workspaceId: Id) =>
  requestControlPlane<CloudflareWorkspaceMutationResponse>(
    `/workspaces/${encodeURIComponent(workspaceId)}/activate`,
    { method: "POST" },
  );

export const getCloudflareAgents = () => requestControlPlane<CloudflareAgentsResponse>("/agents");

export const getCloudflareAgentBehaviorTemplates = () =>
  requestControlPlane<CloudflareAgentBehaviorTemplatesResponse>("/agent-behavior-templates");

export const createCloudflareAgent = (input: {
  name: string;
  description?: string;
  profile: AgentSummary["profile"];
  model?: string;
  behaviorTemplateId?: string;
  activate?: boolean;
}) =>
  requestControlPlane<CloudflareAgentMutationResponse>("/agents", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const activateCloudflareAgent = (agentId: Id) =>
  requestControlPlane<CloudflareAgentMutationResponse>(
    `/agents/${encodeURIComponent(agentId)}/activate`,
    { method: "POST" },
  );

export const getLatestControlPlaneEvents = (limit = 50) =>
  requestControlPlane<ControlPlaneEventsResponse>(
    `/events/latest?limit=${encodeURIComponent(String(limit))}`,
  );

export const streamControlPlaneEvents = async (
  after?: string | null,
  lastEventId?: string | null,
) => {
  const searchParams = new URLSearchParams();
  if (after) searchParams.set("after", after);
  const queryString = searchParams.toString() ? `?${searchParams.toString()}` : "";
  const request = await controlPlaneRequest(`/events/stream${queryString}`, {
    headers: {
      accept: "text/event-stream",
      ...(lastEventId && !after ? { "Last-Event-ID": lastEventId } : {}),
    },
  });
  const response = await fetchWithTimeout(request.url, request.init);

  if (!response.ok) {
    throw new ControlPlaneRequestError(await parseErrorBody(response), response.status);
  }

  return response;
};
