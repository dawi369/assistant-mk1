import type { Id } from "@/lib/agent-framework/contracts";
import { getWorkbenchIdentityHeaders } from "@/lib/workbench/agent-identity";
import type {
  AgentSummary,
  CloudflareAdminSummaryResponse,
  CloudflareAgentMutationResponse,
  CloudflareAgentsResponse,
  CloudflareOwnedDemoRunResponse,
  CloudflareWorkspaceMutationResponse,
  CloudflareWorkspacesResponse,
  ChatRuntimeSummaryResponse,
  ControlPlaneEventsResponse,
  WorkspaceContextResponse,
} from "@/lib/workbench/workbench-types";

export type {
  CloudflareAdminSummaryResponse,
  CloudflareAgentMutationResponse,
  CloudflareAgentsResponse,
  CloudflareOwnedDemoRunResponse,
  CloudflareOwnedDemoRunSnapshot,
  CloudflareWorkspaceMutationResponse,
  CloudflareWorkspacesResponse,
  ChatRuntimeSummary,
  ChatRuntimeSummaryResponse,
  ControlPlaneEvent,
  ControlPlaneEventsResponse,
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
  return baseUrl && token ? { baseUrl, token } : null;
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

  return {
    url: `${config.baseUrl}${path}`,
    init: {
      ...init,
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json",
        ...identityHeaders,
        ...init?.headers,
      },
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

export const getCloudflareAdminSummary = () =>
  requestControlPlane<CloudflareAdminSummaryResponse>("/admin/workspace-summary");

export const getChatRuntimeSummary = () =>
  requestControlPlane<ChatRuntimeSummaryResponse>("/chat/runtime-summary");

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

export const createCloudflareAgent = (input: {
  name: string;
  description?: string;
  profile: AgentSummary["profile"];
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

export const streamControlPlaneEvents = async (after?: string | null) => {
  const searchParams = new URLSearchParams();
  if (after) searchParams.set("after", after);
  const queryString = searchParams.toString() ? `?${searchParams.toString()}` : "";
  const request = await controlPlaneRequest(`/events/stream${queryString}`, {
    headers: {
      accept: "text/event-stream",
    },
  });
  return fetch(request.url, request.init);
};
