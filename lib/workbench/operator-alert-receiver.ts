import { hmacSha256Base64Url, sha256Hex } from "./control-plane-signing";

const maximumAlertAgeMs = 10 * 60 * 1000;
const maximumAlertBodyBytes = 64 * 1024;

export type OperatorAlertWebhookPayload = {
  version: 1;
  occurredAt: string;
  alert: {
    id: string;
    severity: "warning" | "critical";
    code: string;
    summary: string;
    targetType?: string;
    targetId?: string;
    status: string;
    deliveryStatus: string;
    deliveryAttempts: number;
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const constantTimeEqual = async (left: string, right: string) => {
  const [leftHash, rightHash] = await Promise.all([sha256Hex(left), sha256Hex(right)]);
  let difference = leftHash.length ^ rightHash.length;
  for (let index = 0; index < Math.max(leftHash.length, rightHash.length); index += 1) {
    difference |= (leftHash.charCodeAt(index) || 0) ^ (rightHash.charCodeAt(index) || 0);
  }
  return difference === 0;
};

const parsePayload = (body: string): OperatorAlertWebhookPayload | null => {
  const parsed = JSON.parse(body) as unknown;
  if (!isRecord(parsed) || parsed.version !== 1 || typeof parsed.occurredAt !== "string")
    return null;
  const alert = parsed.alert;
  if (
    !isRecord(alert) ||
    typeof alert.id !== "string" ||
    (alert.severity !== "warning" && alert.severity !== "critical") ||
    typeof alert.code !== "string" ||
    typeof alert.summary !== "string" ||
    typeof alert.status !== "string" ||
    typeof alert.deliveryStatus !== "string" ||
    typeof alert.deliveryAttempts !== "number" ||
    (alert.targetType !== undefined && typeof alert.targetType !== "string") ||
    (alert.targetId !== undefined && typeof alert.targetId !== "string")
  ) {
    return null;
  }
  return parsed as OperatorAlertWebhookPayload;
};

export const verifyOperatorAlertWebhook = async (input: {
  body: string;
  signature: string;
  secret: string;
  now?: Date;
}): Promise<
  | { ok: true; payload: OperatorAlertWebhookPayload }
  | { ok: false; code: "body_too_large" | "signature_invalid" | "payload_invalid" | "stale" }
> => {
  if (new TextEncoder().encode(input.body).byteLength > maximumAlertBodyBytes) {
    return { ok: false, code: "body_too_large" };
  }
  const expected = await hmacSha256Base64Url(input.secret, input.body);
  if (!input.signature || !(await constantTimeEqual(input.signature, expected))) {
    return { ok: false, code: "signature_invalid" };
  }
  let payload: OperatorAlertWebhookPayload | null;
  try {
    payload = parsePayload(input.body);
  } catch {
    payload = null;
  }
  if (!payload) return { ok: false, code: "payload_invalid" };
  const occurredAt = Date.parse(payload.occurredAt);
  const now = (input.now ?? new Date()).getTime();
  if (!Number.isFinite(occurredAt) || Math.abs(now - occurredAt) > maximumAlertAgeMs) {
    return { ok: false, code: "stale" };
  }
  return { ok: true, payload };
};
