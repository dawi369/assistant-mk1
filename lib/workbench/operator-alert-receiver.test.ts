import { describe, expect, it } from "vitest";

import { hmacSha256Base64Url } from "./control-plane-signing";
import {
  shouldInjectOperatorAlertReceiverOutage,
  type OperatorAlertWebhookPayload,
  verifyOperatorAlertWebhook,
} from "./operator-alert-receiver";

const secret = "operator-alert-signing-secret-0001";
const payload = {
  version: 1,
  occurredAt: "2026-07-12T12:00:00.000Z",
  alert: {
    id: "alert-1",
    severity: "critical",
    code: "lease_expired",
    summary: "Trigger dispatch lease expired.",
    targetType: "triggerDispatch",
    targetId: "dispatch-1",
    status: "open",
    deliveryStatus: "pending",
    deliveryAttempts: 0,
  },
} satisfies OperatorAlertWebhookPayload;

describe("operator alert receiver", () => {
  it("accepts a fresh signed redacted alert payload", async () => {
    const body = JSON.stringify(payload);
    const result = await verifyOperatorAlertWebhook({
      body,
      signature: await hmacSha256Base64Url(secret, body),
      secret,
      now: new Date("2026-07-12T12:01:00.000Z"),
    });

    expect(result).toEqual({ ok: true, payload });
  });

  it("rejects invalid signatures before trusting payload fields", async () => {
    await expect(
      verifyOperatorAlertWebhook({
        body: JSON.stringify(payload),
        signature: "invalid",
        secret,
        now: new Date("2026-07-12T12:01:00.000Z"),
      }),
    ).resolves.toEqual({ ok: false, code: "signature_invalid" });
  });

  it("rejects replayed and malformed payloads", async () => {
    const staleBody = JSON.stringify(payload);
    await expect(
      verifyOperatorAlertWebhook({
        body: staleBody,
        signature: await hmacSha256Base64Url(secret, staleBody),
        secret,
        now: new Date("2026-07-12T13:00:00.000Z"),
      }),
    ).resolves.toEqual({ ok: false, code: "stale" });

    const malformedBody = JSON.stringify({ version: 1, occurredAt: payload.occurredAt });
    await expect(
      verifyOperatorAlertWebhook({
        body: malformedBody,
        signature: await hmacSha256Base64Url(secret, malformedBody),
        secret,
        now: new Date("2026-07-12T12:01:00.000Z"),
      }),
    ).resolves.toEqual({ ok: false, code: "payload_invalid" });
  });

  it("injects exactly one acceptance-only receiver failure", () => {
    const conformancePayload = {
      ...payload,
      alert: { ...payload.alert, code: "conformance.receiver_outage" },
    } satisfies OperatorAlertWebhookPayload;
    expect(shouldInjectOperatorAlertReceiverOutage(conformancePayload, true)).toBe(true);
    expect(
      shouldInjectOperatorAlertReceiverOutage(
        { ...conformancePayload, alert: { ...conformancePayload.alert, deliveryAttempts: 1 } },
        true,
      ),
    ).toBe(false);
    expect(shouldInjectOperatorAlertReceiverOutage(conformancePayload, false)).toBe(false);
  });
});
