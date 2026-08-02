import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { createSmokeContext, defaultWorkspaceId, sleep, type TenantIdentity } from "./smoke-utils";
import { renderEnvironmentConfig } from "./render-environment-config";
import { isEnvironmentTarget } from "./workbench-environment";

type DataJob = {
  id: string;
  status: string;
  attemptCount: number;
  lastErrorCode?: string;
  contentSha256?: string;
};

const enabled = process.env.WORKBENCH_HOSTED_DATA_LIFECYCLE_MODE === "true";
const target = process.env.WORKBENCH_ENVIRONMENT?.trim() ?? "";
const commit = process.env.GITHUB_SHA?.trim() ?? "";
if (!enabled) throw new Error("WORKBENCH_HOSTED_DATA_LIFECYCLE_MODE=true is required");
if (!isEnvironmentTarget(target) || target !== "acceptance") {
  throw new Error("Hosted destructive lifecycle acceptance is restricted to acceptance");
}
if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("GITHUB_SHA must be a full commit");

const rendered = renderEnvironmentConfig(target);
const { readJson, fetchRaw, assertStatus } = createSmokeContext({
  pollTimeoutDefault: 6 * 60_000,
  pollIntervalDefault: 2_000,
});
const suffix = `${commit.slice(0, 8)}-${Date.now().toString(36)}`;
const accountId = `workos-org:lifecycle-acceptance-${suffix}`;
const owner: TenantIdentity = {
  userId: `lifecycle-acceptance-owner-${suffix}`,
  accountId,
  accountSource: "workos-organization",
  workspaceId: defaultWorkspaceId(accountId),
  email: `lifecycle-acceptance-${suffix}@example.com`,
  name: "Lifecycle Acceptance",
  role: "owner",
  roles: ["owner"],
  permissions: ["workbench:read"],
  authMode: "workos",
  workspaceSource: "workos-organization",
};

const poll = async <T>(
  label: string,
  read: () => Promise<T | undefined>,
  timeoutMs = 6 * 60_000,
) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined) return value;
    await sleep(2_000);
  }
  throw new Error(`${label} did not complete within ${timeoutMs}ms`);
};

const d1Query = <Row>(sql: string): Row[] => {
  const output = execFileSync(
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
      "--json",
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, CI: "true", NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const start = output.indexOf("[");
  if (start < 0) throw new Error("Wrangler did not return D1 JSON");
  const result = (
    JSON.parse(output.slice(start)) as Array<{ success?: boolean; results?: Row[] }>
  )[0];
  if (!result?.success || !result.results) throw new Error("Hosted D1 evidence query failed");
  return result.results;
};

const safeSql = (value: string) => `'${value.replaceAll("'", "''")}'`;

const main = async () => {
  const startedAt = new Date().toISOString();
  await readJson("/admin/workspace-summary", owner);
  await readJson("/chat/session/threads", owner, {
    method: "POST",
    body: JSON.stringify({ title: "Hosted lifecycle export fixture" }),
  });
  await readJson("/workbench/retention-policy", owner, {
    method: "PATCH",
    body: JSON.stringify({
      artifactRetentionDays: 90,
      operationalEventRetentionDays: 30,
      runtimeTraceRetentionDays: 14,
      chatMessageRetentionDays: 90,
      runPayloadRetentionDays: 90,
      auditActionRetentionDays: 365,
      confirm: true,
    }),
  });

  const exportCreated = await readJson<{
    job: { id: string; injectedFailurePhase?: string };
  }>("/workbench/data-exports?e2eFailPhase=after_d1_materialized", owner, { method: "POST" });
  if (exportCreated.job.injectedFailurePhase !== "after_d1_materialized") {
    throw new Error("Acceptance Worker did not acknowledge lifecycle fault injection");
  }
  const completedExport = await poll("resumed export", async () => {
    const body = await readJson<{ job: DataJob }>(
      `/workbench/data-exports/${encodeURIComponent(exportCreated.job.id)}`,
      owner,
    );
    return body.job.status === "completed" && body.job.attemptCount >= 2 ? body.job : undefined;
  });
  if (!completedExport.contentSha256?.match(/^[a-f0-9]{64}$/)) {
    throw new Error("Completed export is missing its content checksum");
  }
  const archive = await fetchRaw(
    `/workbench/data-exports/${encodeURIComponent(exportCreated.job.id)}/download`,
    owner,
  );
  if (!archive.ok || archive.headers.get("cache-control") !== "private, no-store") {
    throw new Error(`Hosted export download failed with ${archive.status}`);
  }
  const archiveBytes = new Uint8Array(await archive.arrayBuffer());
  if (archiveBytes.length < 4 || archiveBytes[0] !== 0x50 || archiveBytes[1] !== 0x4b) {
    throw new Error("Hosted export was not a ZIP archive");
  }

  const otherAccountId = `${accountId}:other`;
  const other: TenantIdentity = {
    ...owner,
    userId: `${owner.userId}-other`,
    accountId: otherAccountId,
    workspaceId: defaultWorkspaceId(otherAccountId),
    email: `lifecycle-acceptance-other-${suffix}@example.com`,
  };
  await readJson("/admin/workspace-summary", other);
  await assertStatus(
    `/workbench/data-exports/${encodeURIComponent(exportCreated.job.id)}`,
    other,
    404,
  );

  const receiptsBefore = Number(
    d1Query<{ count: number }>("SELECT COUNT(*) AS count FROM control_deletion_receipts")[0]
      ?.count ?? 0,
  );
  const deletion = await readJson<{ deletion: { purgeJobId: string } }>(
    "/workbench/workspace-deletion",
    owner,
    {
      method: "POST",
      body: JSON.stringify({
        workspaceName: "Default Workspace",
        reauthenticatedAt: new Date().toISOString(),
        e2eFailPhase: "receipt_creation",
      }),
    },
  );
  const failedPurge = await poll("failed purge", async () => {
    const body = await readJson<{
      deletion: { status: string; attemptCount?: number; canRetry?: boolean };
    }>("/workbench/workspace-deletion", owner);
    return body.deletion.status === "failed" && body.deletion.canRetry ? body.deletion : undefined;
  });
  if ((failedPurge.attemptCount ?? 0) < 3)
    throw new Error("Purge did not exhaust automatic retries");
  await readJson("/workbench/workspace-deletion/retry", owner, {
    method: "POST",
    body: JSON.stringify({
      workspaceName: "Default Workspace",
      reauthenticatedAt: new Date().toISOString(),
    }),
  });

  const receipt = await poll("final deletion receipt", async () => {
    const workspaceCount = Number(
      d1Query<{ count: number }>(
        `SELECT COUNT(*) AS count FROM workspaces WHERE id = ${safeSql(owner.workspaceId ?? "")}`,
      )[0]?.count ?? 1,
    );
    const receipts = d1Query<{ count: number; completed_at: string | null }>(
      "SELECT COUNT(*) AS count, MAX(completed_at) AS completed_at FROM control_deletion_receipts",
    )[0];
    return workspaceCount === 0 && Number(receipts?.count ?? 0) > receiptsBefore
      ? { completed_at: receipts?.completed_at }
      : undefined;
  });

  const report = {
    schemaVersion: 1,
    target,
    commit,
    startedAt,
    completedAt: new Date().toISOString(),
    ok: true,
    workspaceId: owner.workspaceId,
    exportJobId: exportCreated.job.id,
    exportAttempts: completedExport.attemptCount,
    exportContentSha256: completedExport.contentSha256,
    purgeJobId: deletion.deletion.purgeJobId,
    purgeFailedAttempts: failedPurge.attemptCount,
    purgeRetried: true,
    deletionReceiptRecorded: Boolean(receipt.completed_at),
    crossTenantStatus: 404,
  };
  const directory = resolve(process.cwd(), "output/release", commit);
  mkdirSync(directory, { recursive: true });
  const outputPath = resolve(directory, "data-lifecycle-acceptance.json");
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ ...report, outputPath }, null, 2));
};

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
