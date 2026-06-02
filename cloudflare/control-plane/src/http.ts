import type { AgentIdentity, Env } from "./types";

const userIdHeader = "x-assistant-mk1-user-id";
const workspaceIdHeader = "x-assistant-mk1-workspace-id";
const agentIdHeader = "x-assistant-mk1-agent-id";

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
  if (authorization !== `Bearer ${token}`) {
    return json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  return null;
};

const readRequiredHeader = (request: Request, name: string) => {
  const value = request.headers.get(name)?.trim();
  return value ? value : null;
};

export const requireAgentIdentity = (
  request: Request,
): { ok: true; identity: AgentIdentity } | { ok: false; response: Response } => {
  const userId = readRequiredHeader(request, userIdHeader);
  const workspaceId = readRequiredHeader(request, workspaceIdHeader);
  const agentId = readRequiredHeader(request, agentIdHeader);

  if (!userId || !workspaceId || !agentId) {
    return {
      ok: false,
      response: json(
        {
          ok: false,
          error:
            "x-assistant-mk1-user-id, x-assistant-mk1-workspace-id, and x-assistant-mk1-agent-id are required",
        },
        { status: 400 },
      ),
    };
  }

  return {
    ok: true,
    identity: {
      scope: { userId, workspaceId },
      agentId,
    },
  };
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
