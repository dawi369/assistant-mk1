import { NextResponse, type NextRequest } from "next/server";

import { signFacadeRequest } from "@/lib/workbench/control-plane-signing";

export const runtime = "nodejs";

const maximumWebhookBytes = 32 * 1024;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ publicId: string }> },
) {
  const { publicId } = await context.params;
  if (!/^hook-[A-Za-z0-9-]{8,160}$/.test(publicId)) {
    return NextResponse.json({ ok: false, error: "Trigger webhook not found" }, { status: 404 });
  }
  const baseUrl = process.env.CLOUDFLARE_CONTROL_PLANE_URL?.replace(/\/$/, "");
  const controlToken = process.env.CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN?.trim();
  const signingSecret =
    process.env.CLOUDFLARE_CONTROL_PLANE_WEBHOOK_FACADE_SIGNING_SECRET?.trim() ??
    process.env.CLOUDFLARE_CONTROL_PLANE_FACADE_SIGNING_SECRET?.trim();
  if (!baseUrl || !controlToken || !signingSecret) {
    return NextResponse.json(
      { ok: false, error: "Webhook ingress is unavailable" },
      { status: 503 },
    );
  }
  const authorization = request.headers.get("authorization") ?? "";
  const triggerSecret = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!triggerSecret) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > maximumWebhookBytes) {
    return NextResponse.json({ ok: false, error: "Webhook body is too large" }, { status: 413 });
  }
  const path = `/trigger-ingress/${encodeURIComponent(publicId)}`;
  const headers: Record<string, string> = {
    authorization: `Bearer ${controlToken}`,
    "content-type": "application/json",
    "idempotency-key": idempotencyKey,
    "x-assistant-mk1-trigger-secret": triggerSecret,
  };
  Object.assign(
    headers,
    await signFacadeRequest({
      secret: signingSecret,
      method: "POST",
      pathWithQuery: path,
      body,
      headers,
    }),
  );
  const response = await fetch(`${baseUrl}${path}`, { method: "POST", headers, body });
  const responseText = await response.text();
  return new NextResponse(responseText || null, {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
  });
}
