type JsonRecord = Record<string, unknown>;

type SmokeSnapshot = {
  intent?: JsonRecord | null;
  run?: {
    status?: string;
  } | null;
  toolCalls?: unknown[];
  artifacts?: unknown[];
  decisions?: unknown[];
  auditEvents?: unknown[];
};

type SmokeResponse = {
  snapshot?: SmokeSnapshot | null;
};

const baseUrl = (process.env.SMOKE_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const pollTimeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? 10_000);
const pollIntervalMs = Number(process.env.SMOKE_POLL_INTERVAL_MS ?? 400);

const readJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${baseUrl}${path}`, init);
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForCompletedRun = async () => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < pollTimeoutMs) {
    const latest = requireSnapshot(
      await readJson<SmokeResponse>("/api/workbench/demo-runs/latest"),
      "latest demo run",
    );

    if (latest.run?.status === "completed") {
      return latest;
    }

    if (latest.run?.status === "failed" || latest.run?.status === "cancelled") {
      throw new Error(`demo run reached terminal status ${latest.run.status}`);
    }

    await sleep(pollIntervalMs);
  }

  throw new Error(`demo run did not complete within ${pollTimeoutMs}ms`);
};

const main = async () => {
  console.log(`Smoking workbench at ${baseUrl}`);

  const health = await readJson<JsonRecord>("/api/health");
  if (health.ok !== true) {
    throw new Error("/api/health did not report ok=true");
  }

  const started = requireSnapshot(
    await readJson<SmokeResponse>("/api/workbench/demo-runs", { method: "POST" }),
    "started demo run",
  );
  if (started.run?.status !== "queued") {
    throw new Error(`expected new run to start queued, got ${started.run?.status ?? "missing"}`);
  }

  const completed = await waitForCompletedRun();
  if (!completed.intent) throw new Error("completed snapshot is missing intent");
  if (!completed.run) throw new Error("completed snapshot is missing run");

  requireArray(completed, "toolCalls");
  requireArray(completed, "artifacts");
  requireArray(completed, "decisions");
  requireArray(completed, "auditEvents");

  console.log("Workbench smoke passed");
  console.log(
    JSON.stringify(
      {
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
