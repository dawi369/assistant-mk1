import { runSmoke, sleep } from "./smoke-utils";

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

const baseUrl = (process.env.SMOKE_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const pollTimeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? 10_000);
const pollIntervalMs = Number(process.env.SMOKE_POLL_INTERVAL_MS ?? 400);
const expectedScope =
  process.env.WORKBENCH_DEV_USER_ID && process.env.WORKBENCH_DEV_WORKSPACE_ID
    ? {
        userId: process.env.WORKBENCH_DEV_USER_ID,
        workspaceId: process.env.WORKBENCH_DEV_WORKSPACE_ID,
      }
    : null;

const readJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${baseUrl}${path}`, init);
  if (!response.ok) {
    const body = await response.text();
    if (response.status === 401) {
      throw new Error(
        `${init?.method ?? "GET"} ${path} failed with 401: ${body}\n` +
          "This smoke uses the Vercel/Next same-origin workbench route and is only valid with a local dev fallback or an authenticated browser/session harness. For hosted deploy verification, use pnpm smoke:cloudflare-workbench-run against the Worker.",
      );
    }
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
  if (!expectedScope) return;
  if (
    snapshot.scope?.userId !== expectedScope.userId ||
    snapshot.scope.workspaceId !== expectedScope.workspaceId
  ) {
    throw new Error(`${label} returned the wrong tenant scope`);
  }
};

const waitForCompletedRun = async (runId: string) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < pollTimeoutMs) {
    const latest = requireSnapshot(
      await readJson<SmokeResponse>("/api/workbench/cloudflare-demo-runs/latest"),
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

runSmoke("Cloudflare-owned workbench smoke", async () => {
  console.log(`Smoking Cloudflare-owned workbench run at ${baseUrl}`);

  const started = requireSnapshot(
    await readJson<SmokeResponse>("/api/workbench/cloudflare-demo-runs", { method: "POST" }),
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
});

export {};
