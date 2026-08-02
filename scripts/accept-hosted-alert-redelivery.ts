import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { createSmokeContext, defaultWorkspaceId, sleep, type TenantIdentity } from "./smoke-utils";
import { renderEnvironmentConfig } from "./render-environment-config";

const target = process.env.WORKBENCH_ENVIRONMENT?.trim() ?? "";
const commit = process.env.GITHUB_SHA?.trim() ?? "";
if (process.env.WORKBENCH_HOSTED_ALERT_REDELIVERY_MODE !== "true") {
  throw new Error("WORKBENCH_HOSTED_ALERT_REDELIVERY_MODE=true is required");
}
if (target !== "acceptance") throw new Error("Alert outage injection is acceptance-only");
if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("GITHUB_SHA must be a full commit");

const rendered = renderEnvironmentConfig("acceptance");
const { readJson } = createSmokeContext({ pollTimeoutDefault: 4 * 60_000 });
const suffix = `${commit.slice(0, 8)}-${Date.now().toString(36)}`;
const accountId = `workos-org:alert-redelivery-${suffix}`;
const owner: TenantIdentity = {
  userId: `alert-redelivery-owner-${suffix}`,
  accountId,
  accountSource: "workos-organization",
  workspaceId: defaultWorkspaceId(accountId),
  email: `alert-redelivery-${suffix}@example.com`,
  name: "Alert Redelivery Acceptance",
  role: "owner",
  roles: ["owner"],
  permissions: ["workbench:read"],
  authMode: "workos",
  workspaceSource: "workos-organization",
};
const safeSql = (value: string) => `'${value.replaceAll("'", "''")}'`;
const d1Execute = (sql: string) => {
  execFileSync(
    "pnpm",
    [
      "exec",
      "wrangler",
      "d1",
      "execute",
      rendered.manifest.cloudflare.d1DatabaseName,
      "--remote",
      "--config",
      rendered.wranglerPath,
      "--command",
      sql,
      "--yes",
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, CI: "true", NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
};

const main = async () => {
  const startedAt = new Date().toISOString();
  const summary = await readJson<{ activeAgent?: { id?: string } }>(
    "/admin/workspace-summary",
    owner,
  );
  owner.agentId = summary.activeAgent?.id;
  const alertId = `cf-alert-redelivery-${suffix}`;
  const timestamp = new Date().toISOString();
  d1Execute(`
    INSERT INTO control_operator_alerts (
      id, user_id, workspace_id, agent_id, severity, code, summary, target_type, target_id,
      status, dedup_key, delivery_status, delivery_attempts, data_json, created_at, updated_at
    ) VALUES (
      ${safeSql(alertId)}, ${safeSql(owner.userId)}, ${safeSql(owner.workspaceId ?? "")},
      ${safeSql(owner.agentId ?? "")}, 'warning', 'conformance.receiver_outage',
      'Acceptance receiver outage and redelivery drill.', 'releaseEvidence', ${safeSql(commit)},
      'open', ${safeSql(`receiver-outage:${commit}:${suffix}`)}, 'pending', 0, '{}',
      ${safeSql(timestamp)}, ${safeSql(timestamp)}
    )
  `);

  let observedFailed = false;
  let delivered:
    | { id: string; deliveryStatus: string; deliveryAttempts: number; lastDeliveryAt?: string }
    | undefined;
  const deadline = Date.now() + 4 * 60_000;
  while (Date.now() < deadline && !delivered) {
    const body = await readJson<{
      alerts?: Array<{
        id: string;
        deliveryStatus: string;
        deliveryAttempts: number;
        lastDeliveryAt?: string;
      }>;
    }>("/admin/operator-alerts?limit=100", owner);
    const alert = body.alerts?.find((candidate) => candidate.id === alertId);
    if (alert?.deliveryStatus === "failed" && alert.deliveryAttempts >= 1) observedFailed = true;
    if (alert?.deliveryStatus === "delivered" && alert.deliveryAttempts >= 2) delivered = alert;
    if (!delivered) await sleep(2_000);
  }
  if (!observedFailed) throw new Error("Receiver outage was not durably observed");
  if (!delivered) throw new Error("Failed operator alert was not redelivered");

  const report = {
    schemaVersion: 1,
    target,
    commit,
    startedAt,
    completedAt: new Date().toISOString(),
    ok: true,
    alertId,
    receiverFailureObserved: true,
    deliveryStatus: delivered.deliveryStatus,
    deliveryAttempts: delivered.deliveryAttempts,
    lastDeliveryAt: delivered.lastDeliveryAt,
  };
  const directory = resolve(process.cwd(), "output/release", commit);
  mkdirSync(directory, { recursive: true });
  const outputPath = resolve(directory, "alert-outage-redelivery.json");
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ ...report, outputPath }, null, 2));
};

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
