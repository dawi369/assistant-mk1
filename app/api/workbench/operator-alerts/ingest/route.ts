import * as Sentry from "@sentry/nextjs";

import { verifyOperatorAlertWebhook } from "@/lib/workbench/operator-alert-receiver";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.WORKBENCH_OPERATOR_ALERT_SIGNING_SECRET?.trim();
  if (!secret) return Response.json({ ok: false, error: "not configured" }, { status: 503 });
  const body = await request.text();
  const verification = await verifyOperatorAlertWebhook({
    body,
    signature: request.headers.get("x-assistant-mk1-alert-signature") ?? "",
    secret,
  });
  if (!verification.ok) {
    const status = verification.code === "body_too_large" ? 413 : 401;
    return Response.json(
      { ok: false, error: "alert rejected", code: verification.code },
      { status },
    );
  }

  const { alert } = verification.payload;
  Sentry.captureMessage(`Assistant-mk1 operator alert: ${alert.code}`, {
    level: alert.severity === "critical" ? "error" : "warning",
    fingerprint: ["assistant-mk1-operator-alert", alert.id],
    tags: {
      service: "assistant-mk1",
      "operator_alert.code": alert.code,
      "operator_alert.severity": alert.severity,
    },
    extra: {
      alertId: alert.id,
      summary: alert.summary,
      targetType: alert.targetType,
      targetId: alert.targetId,
      status: alert.status,
      deliveryStatus: alert.deliveryStatus,
      deliveryAttempts: alert.deliveryAttempts,
    },
  });
  await Sentry.flush(2_000);
  return new Response(null, { status: 204 });
}
