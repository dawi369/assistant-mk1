import type { Id, RunStatus } from "@/lib/agent-framework/contracts";

export type CloudflareRunProbeRecord = {
  scope: {
    userId: Id;
    workspaceId: Id;
  };
  agentId: Id;
  runId: Id;
  status: RunStatus;
  summary?: string;
  data?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type CloudflareRunProbeResult =
  | {
      enabled: false;
      reason: "missing_config";
    }
  | {
      enabled: true;
      ok: true;
      probe: CloudflareRunProbeRecord;
    }
  | {
      enabled: true;
      ok: false;
      status?: number;
      error: string;
    };

type RecordRunProbeInput = {
  runId: Id;
  workflowIntentId?: Id;
  status: RunStatus;
  summary: string;
  data?: Record<string, unknown>;
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

export const recordCloudflareRunProbe = async (
  input: RecordRunProbeInput,
): Promise<CloudflareRunProbeResult> => {
  const config = getControlPlaneConfig();
  if (!config) return { enabled: false, reason: "missing_config" };

  try {
    const response = await fetchWithTimeout(`${config.baseUrl}/data-client/runs/probe`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        runId: input.runId,
        workflowIntentId: input.workflowIntentId,
        status: input.status,
        summary: input.summary,
        data: input.data ?? {},
      }),
    });

    if (!response.ok) {
      return {
        enabled: true,
        ok: false,
        status: response.status,
        error: await parseErrorBody(response),
      };
    }

    const body = (await response.json()) as { probe?: CloudflareRunProbeRecord | null };
    if (!body.probe) {
      return {
        enabled: true,
        ok: false,
        error: "Control plane did not return a run probe",
      };
    }

    return { enabled: true, ok: true, probe: body.probe };
  } catch (error) {
    return {
      enabled: true,
      ok: false,
      error: error instanceof Error ? error.message : "Unknown control-plane request failure",
    };
  }
};
