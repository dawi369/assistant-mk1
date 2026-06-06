type TenantIdentity = {
  userId: string;
  accountId: string;
  accountSource: string;
  workspaceId: string;
  email?: string;
  name?: string;
  role?: string;
  roles?: string[];
  permissions?: string[];
  authMode?: string;
  workspaceSource?: string;
};

type SmokeSnapshot = {
  scope?: {
    userId?: string;
    workspaceId?: string;
  };
  intent?: unknown;
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

const baseUrl = (process.env.CLOUDFLARE_CONTROL_PLANE_URL ?? "http://localhost:8787").replace(
  /\/$/,
  "",
);
const token = process.env.CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN ?? "local-dev-token";
const pollTimeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? 30_000);
const pollIntervalMs = Number(process.env.SMOKE_POLL_INTERVAL_MS ?? 500);
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const defaultWorkspaceId = (accountId: string) => `workspace:${accountId}:default`;
const accountId = process.env.SMOKE_WORKOS_ACCOUNT_ID ?? `workos-org:workbench-org-${suffix}`;

const identity: TenantIdentity = {
  userId: process.env.SMOKE_WORKOS_USER_ID ?? `workbench-user-${suffix}`,
  accountId,
  accountSource: process.env.SMOKE_ACCOUNT_SOURCE ?? "workos-organization",
  workspaceId: process.env.SMOKE_WORKOS_WORKSPACE_ID ?? defaultWorkspaceId(accountId),
  email: process.env.SMOKE_WORKOS_USER_EMAIL ?? `workbench-${suffix}@example.com`,
  name: process.env.SMOKE_WORKOS_USER_NAME ?? "Workbench Smoke User",
  role: process.env.SMOKE_WORKOS_ROLE ?? "owner",
  roles: (process.env.SMOKE_WORKOS_ROLES ?? "owner").split(",").filter(Boolean),
  permissions: (process.env.SMOKE_WORKOS_PERMISSIONS ?? "workbench:read,workbench:demo")
    .split(",")
    .filter(Boolean),
  authMode: "workos",
  workspaceSource: process.env.SMOKE_WORKSPACE_SOURCE ?? "workos-organization",
};

const headersFor = (tenant: TenantIdentity) => {
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-assistant-mk1-user-id": tenant.userId,
    "x-assistant-mk1-account-id": tenant.accountId,
    "x-assistant-mk1-account-source": tenant.accountSource,
    "x-assistant-mk1-workspace-id": tenant.workspaceId,
  };

  if (tenant.email) headers["x-assistant-mk1-user-email"] = tenant.email;
  if (tenant.name) headers["x-assistant-mk1-user-name"] = tenant.name;
  if (tenant.role) headers["x-assistant-mk1-membership-role"] = tenant.role;
  if (tenant.roles) headers["x-assistant-mk1-membership-roles"] = JSON.stringify(tenant.roles);
  if (tenant.permissions) {
    headers["x-assistant-mk1-membership-permissions"] = JSON.stringify(tenant.permissions);
  }
  if (tenant.authMode) headers["x-assistant-mk1-auth-mode"] = tenant.authMode;
  if (tenant.workspaceSource) headers["x-assistant-mk1-workspace-source"] = tenant.workspaceSource;

  return headers;
};

const readJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...headersFor(identity),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${init?.method ?? "GET"} ${path} failed with ${response.status}: ${body}`);
  }
  return (await response.json()) as T;
};

const requireSnapshot = (body: SmokeResponse, label: string): SmokeSnapshot => {
  if (!body.snapshot) {
    throw new Error(`${label} did not return a snapshot`);
  }
  return body.snapshot;
};

const requireArray = (snapshot: SmokeSnapshot, key: keyof SmokeSnapshot) => {
  const value = snapshot[key];
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`completed snapshot is missing ${key}`);
  }
};

const requireExpectedScope = (snapshot: SmokeSnapshot, label: string) => {
  if (
    snapshot.scope?.userId !== identity.userId ||
    snapshot.scope.workspaceId !== identity.workspaceId
  ) {
    throw new Error(`${label} returned the wrong tenant scope`);
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForCompletedRun = async (runId: string) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < pollTimeoutMs) {
    const latest = requireSnapshot(
      await readJson<SmokeResponse>("/workbench/demo-runs/latest"),
      "latest Cloudflare-owned demo run",
    );

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

const main = async () => {
  console.log(`Smoking Cloudflare workbench run at ${baseUrl}`);

  const started = requireSnapshot(
    await readJson<SmokeResponse>("/workbench/demo-runs", { method: "POST" }),
    "started Cloudflare-owned demo run",
  );
  if (started.run?.status !== "queued") {
    throw new Error(`expected new run to start queued, got ${started.run?.status ?? "missing"}`);
  }
  requireExpectedScope(started, "started snapshot");
  if (!started.run.id) throw new Error("started snapshot is missing run id");

  const completed = await waitForCompletedRun(started.run.id);
  if (!completed.intent) throw new Error("completed snapshot is missing intent");
  if (!completed.run) throw new Error("completed snapshot is missing run");
  requireExpectedScope(completed, "completed snapshot");

  requireArray(completed, "toolCalls");
  requireArray(completed, "artifacts");
  requireArray(completed, "decisions");
  requireArray(completed, "auditEvents");

  console.log("Cloudflare workbench run smoke passed");
  console.log(
    JSON.stringify(
      {
        runId: completed.run.id,
        runStatus: completed.run.status,
        toolCalls: completed.toolCalls?.length ?? 0,
        artifacts: completed.artifacts?.length ?? 0,
        decisions: completed.decisions?.length ?? 0,
        auditEvents: completed.auditEvents?.length ?? 0,
      },
      null,
      2,
    ),
  );
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

export {};
