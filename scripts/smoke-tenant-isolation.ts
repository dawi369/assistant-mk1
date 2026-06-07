import { type TenantIdentity, createSmokeContext, runSmoke, sleep } from "./smoke-utils";

type SmokeSnapshot = {
  scope?: {
    userId?: string;
    workspaceId?: string;
  };
  run?: {
    id?: string;
    status?: string;
  } | null;
  toolCalls?: unknown[];
  artifacts?: unknown[];
  decisions?: unknown[];
  auditEvents?: unknown[];
};

type SmokeResponse = {
  ok?: boolean;
  snapshot?: SmokeSnapshot | null;
  error?: string;
};

const { baseUrl, pollTimeoutMs, pollIntervalMs, headersFor, readJson } = createSmokeContext();

const tenants = {
  a: {
    userId: "tenant-a-user",
    workspaceId: "tenant-a-workspace",
    agentId: "tenant-a-agent",
  },
  b: {
    userId: "tenant-b-user",
    workspaceId: "tenant-b-workspace",
    agentId: "tenant-b-agent",
  },
} satisfies Record<string, TenantIdentity>;

const requireSnapshot = (body: SmokeResponse, label: string): SmokeSnapshot => {
  if (!body.snapshot) throw new Error(`${label} did not return a snapshot`);
  return body.snapshot;
};

const requireScope = (snapshot: SmokeSnapshot, identity: TenantIdentity, label: string) => {
  if (
    snapshot.scope?.userId !== identity.userId ||
    snapshot.scope.workspaceId !== identity.workspaceId
  ) {
    throw new Error(`${label} returned the wrong tenant scope`);
  }
};

const requireArray = (snapshot: SmokeSnapshot, key: keyof SmokeSnapshot) => {
  const value = snapshot[key];
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`completed snapshot is missing ${key}`);
  }
};

const waitForCompletedRun = async (identity: TenantIdentity, runId: string) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < pollTimeoutMs) {
    const latest = requireSnapshot(
      await readJson<SmokeResponse>("/workbench/demo-runs/latest", identity),
      "latest tenant-scoped Cloudflare-owned demo run",
    );

    requireScope(latest, identity, "latest run");

    if (latest.run?.id !== runId) {
      throw new Error(`latest run changed unexpectedly from ${runId} to ${latest.run?.id}`);
    }

    if (latest.run?.status === "completed") return latest;
    if (latest.run?.status === "failed" || latest.run?.status === "cancelled") {
      throw new Error(`Cloudflare-owned demo run reached terminal status ${latest.run.status}`);
    }

    await sleep(pollIntervalMs);
  }

  throw new Error(`Cloudflare-owned demo run did not complete within ${pollTimeoutMs}ms`);
};

const startAndComplete = async (identity: TenantIdentity) => {
  const started = requireSnapshot(
    await readJson<SmokeResponse>("/workbench/demo-runs", identity, { method: "POST" }),
    "started tenant-scoped Cloudflare-owned demo run",
  );
  requireScope(started, identity, "started run");
  if (started.run?.status !== "queued") {
    throw new Error(`expected new run to start queued, got ${started.run?.status ?? "missing"}`);
  }
  if (!started.run.id) throw new Error("started snapshot is missing run id");
  const runId = started.run.id;

  const completed = await waitForCompletedRun(identity, runId);
  if (!completed.run) throw new Error("completed snapshot is missing run");
  requireArray(completed, "toolCalls");
  requireArray(completed, "artifacts");
  requireArray(completed, "decisions");
  requireArray(completed, "auditEvents");

  return runId;
};

const assertCrossTenantRunHidden = async (
  visibleTo: TenantIdentity,
  hiddenRunId: string,
  label: string,
) => {
  const response = await fetch(
    `${baseUrl}/workbench/demo-runs/${encodeURIComponent(hiddenRunId)}`,
    {
      headers: headersFor(visibleTo),
    },
  );
  if (response.status !== 404) {
    throw new Error(`${label} expected 404 for cross-tenant run read, got ${response.status}`);
  }
};

runSmoke("Tenant isolation smoke", async () => {
  console.log(`Smoking tenant isolation at ${baseUrl}`);

  const tenantARunId = await startAndComplete(tenants.a);
  const tenantBRunId = await startAndComplete(tenants.b);

  await assertCrossTenantRunHidden(tenants.b, tenantARunId, "tenant B reading tenant A run");
  await assertCrossTenantRunHidden(tenants.a, tenantBRunId, "tenant A reading tenant B run");

  console.log(
    JSON.stringify(
      {
        tenantARunId,
        tenantBRunId,
      },
      null,
      2,
    ),
  );
});

export {};
