import type { Env } from "./types";

export const userIdHeader = "x-assistant-mk1-user-id";
export const workspaceIdHeader = "x-assistant-mk1-workspace-id";
export const agentIdHeader = "x-assistant-mk1-agent-id";

export const json = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...init?.headers,
    },
  });

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const requireAuth = (request: Request, env: Env) => {
  const token = env.CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN;
  if (!token) {
    return json(
      { ok: false, error: "CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN is not configured" },
      { status: 500 },
    );
  }

  const authorization = request.headers.get("authorization");
  const apiKey = request.headers.get("x-api-key");
  if (authorization !== `Bearer ${token}` && apiKey !== token) {
    return json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  return null;
};

export const readRequiredHeader = (request: Request, name: string) => {
  const value = request.headers.get(name)?.trim();
  return value ? value : null;
};

export const parseDataJson = (raw: string) => {
  try {
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

export const parseJson = (raw: string) => {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};
