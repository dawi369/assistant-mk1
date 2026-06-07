import type { Env } from "./types";

export const userIdHeader = "x-assistant-mk1-user-id";
export const accountIdHeader = "x-assistant-mk1-account-id";
export const accountSourceHeader = "x-assistant-mk1-account-source";
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

const textEncoder = new TextEncoder();

const sha256 = (value: string) => crypto.subtle.digest("SHA-256", textEncoder.encode(value));

const constantTimeEqual = async (a: string, b: string) => {
  const [leftBuffer, rightBuffer] = await Promise.all([sha256(a), sha256(b)]);
  const left = new Uint8Array(leftBuffer);
  const right = new Uint8Array(rightBuffer);
  let diff = left.length ^ right.length;

  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }

  return diff === 0;
};

export const internalErrorResponse = (label: string, error: unknown) => {
  const errorId = crypto.randomUUID();
  const message = error instanceof Error ? error.message : String(error);
  console.error(label, {
    errorId,
    error: message,
    name: error instanceof Error ? error.name : "UnknownError",
  });
  return json({ ok: false, error: "Internal control-plane error", errorId }, { status: 500 });
};

export const requireAuth = async (request: Request, env: Env) => {
  const token = env.CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN;
  if (!token) {
    return internalErrorResponse(
      "Control-plane authentication is not configured",
      new Error("CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN is not configured"),
    );
  }

  const authorization = request.headers.get("authorization");
  const apiKey = request.headers.get("x-api-key");
  const [bearerMatch, apiKeyMatch] = await Promise.all([
    authorization?.startsWith("Bearer ")
      ? constantTimeEqual(authorization.slice(7), token)
      : Promise.resolve(false),
    apiKey ? constantTimeEqual(apiKey, token) : Promise.resolve(false),
  ]);

  if (!bearerMatch && !apiKeyMatch) {
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
