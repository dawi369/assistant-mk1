/**
 * Token-protected ingress for external workflow signals.
 *
 * Vercel owns the public bearer-token facade. Cloudflare owns tenant
 * resolution, typed workflow intent/run/audit records, and LangGraph
 * delegation.
 */
import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { toWorkbenchApiError } from "@/lib/workbench/api-errors";
import { signFacadeRequest } from "@/lib/workbench/control-plane-signing";
import { getExternalSignalIdentityHeaders } from "@/lib/workbench/external-signal-identity";
import {
  normalizeExternalSignal,
  type ExternalSignalPayload,
} from "@/lib/workbench/schedule-dispatch";

export const runtime = "nodejs";

const requestTimeoutMs = 10_000;
const controlPlanePath = "/external-signals";

const constantTimeEqual = (a: string, b: string) => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
};

const getBearerToken = (req: NextRequest) => {
  const authorization = req.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length).trim();
};

const getControlPlaneConfig = () => {
  const baseUrl = process.env.CLOUDFLARE_CONTROL_PLANE_URL?.replace(/\/$/, "");
  const token = process.env.CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN;
  const signingSecret = process.env.CLOUDFLARE_CONTROL_PLANE_FACADE_SIGNING_SECRET;
  if (!baseUrl || !token) {
    throw new Error(
      "CLOUDFLARE_CONTROL_PLANE_URL and CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN are required",
    );
  }
  return { baseUrl, token, signingSecret };
};

const parseControlPlaneBody = async (response: Response) => {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: text };
  }
};

const postExternalSignalToControlPlane = async (payload: ExternalSignalPayload) => {
  const config = getControlPlaneConfig();
  const body = JSON.stringify(payload);
  const method = "POST";
  const headers: Record<string, string> = {
    authorization: `Bearer ${config.token}`,
    "content-type": "application/json",
    ...getExternalSignalIdentityHeaders(),
  };

  if (config.signingSecret?.trim()) {
    Object.assign(
      headers,
      await signFacadeRequest({
        secret: config.signingSecret,
        method,
        pathWithQuery: controlPlanePath,
        body,
        headers,
      }),
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch(`${config.baseUrl}${controlPlanePath}`, {
      method,
      headers,
      body,
      signal: controller.signal,
    });
    return {
      ok: response.ok,
      status: response.status,
      body: await parseControlPlaneBody(response),
    };
  } finally {
    clearTimeout(timeout);
  }
};

export async function POST(req: NextRequest) {
  const expectedToken = process.env.EXTERNAL_SIGNAL_TOKEN;
  if (!expectedToken) {
    return NextResponse.json({ error: "EXTERNAL_SIGNAL_TOKEN is not configured" }, { status: 503 });
  }

  const provided = getBearerToken(req);
  if (!provided || !constantTimeEqual(provided, expectedToken)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: ExternalSignalPayload;
  try {
    payload = (await req.json()) as ExternalSignalPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const normalized = normalizeExternalSignal(payload);
  if (!normalized.ok) {
    return NextResponse.json({ error: normalized.error }, { status: normalized.status });
  }

  try {
    const response = await postExternalSignalToControlPlane(payload);
    return NextResponse.json(response.body ?? {}, { status: response.status });
  } catch (error) {
    return toWorkbenchApiError(error, "External signal request failed", { defaultStatus: 500 });
  }
}
