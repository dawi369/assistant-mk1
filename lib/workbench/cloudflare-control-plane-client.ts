import type { Id, RunStatus } from "@/lib/agent-framework/contracts";

export type CloudflareOwnedDemoRunSnapshot = {
  scope: {
    userId: Id;
    workspaceId: Id;
  };
  intent: Record<string, unknown> | null;
  run: {
    id: Id;
    status: RunStatus;
    workflowIntentId?: Id;
    data?: Record<string, unknown>;
  } | null;
  toolCalls: Array<Record<string, unknown>>;
  artifacts: Array<Record<string, unknown>>;
  decisions: Array<Record<string, unknown>>;
  auditEvents: Array<Record<string, unknown>>;
};

export type CloudflareOwnedDemoRunResponse = {
  ok?: boolean;
  snapshot?: CloudflareOwnedDemoRunSnapshot | null;
  error?: string;
};

const requestTimeoutMs = 2_000;

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
  } finally {
    clearTimeout(timeout);
  }
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
  const config = getControlPlaneConfig();
  if (!config) {
    throw new Error(
      "CLOUDFLARE_CONTROL_PLANE_URL and CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN are required",
    );
  }

  const response = await fetchWithTimeout(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(await parseErrorBody(response));
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
