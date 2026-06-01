import { readFileSync } from "node:fs";
import path from "node:path";

type JsonRecord = Record<string, unknown>;

type RunProbe = {
  runId?: string;
  status?: string;
  scope?: {
    userId?: string;
    workspaceId?: string;
  };
};

type ProbeResponse = {
  ok?: boolean;
  probe?: RunProbe | null;
};

const baseUrl = (process.env.CLOUDFLARE_CONTROL_PLANE_URL ?? "http://localhost:8787").replace(
  /\/$/,
  "",
);

const readDevVarsToken = () => {
  const devVarsPath = path.join(process.cwd(), "cloudflare/control-plane/.dev.vars");
  try {
    const raw = readFileSync(devVarsPath, "utf8");
    const match = raw.match(/^CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN=(.+)$/m);
    return match?.[1]?.trim();
  } catch {
    return undefined;
  }
};

const token = process.env.CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN ?? readDevVarsToken();

if (!token) {
  throw new Error("CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN is required for Cloudflare smoke");
}

const readJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${baseUrl}${path}`, init);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${init?.method ?? "GET"} ${path} failed with ${response.status}: ${body}`);
  }
  return (await response.json()) as T;
};

const authed = (init?: RequestInit): RequestInit => ({
  ...init,
  headers: {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    ...init?.headers,
  },
});

const requireProbe = (body: ProbeResponse, label: string): RunProbe => {
  if (body.ok !== true || !body.probe) {
    throw new Error(`${label} did not return a probe`);
  }
  return body.probe;
};

const main = async () => {
  console.log(`Smoking Cloudflare control plane at ${baseUrl}`);

  const health = await readJson<JsonRecord>("/health");
  if (health.ok !== true || health.storage !== "d1-local") {
    throw new Error("/health did not report local D1 readiness");
  }

  const runId = `smoke-run-${Date.now()}`;
  const started = requireProbe(
    await readJson<ProbeResponse>(
      "/data-client/runs/probe",
      authed({
        method: "POST",
        body: JSON.stringify({
          runId,
          status: "running",
          summary: "Cloudflare local smoke run started.",
          data: {
            source: "smoke:cloudflare:local",
          },
        }),
      }),
    ),
    "started probe",
  );
  if (started.runId !== runId || started.status !== "running") {
    throw new Error("started probe returned the wrong run state");
  }

  const completed = requireProbe(
    await readJson<ProbeResponse>(
      "/data-client/runs/probe",
      authed({
        method: "POST",
        body: JSON.stringify({
          runId,
          status: "completed",
          summary: "Cloudflare local smoke run completed.",
          data: {
            source: "smoke:cloudflare:local",
          },
        }),
      }),
    ),
    "completed probe",
  );
  if (completed.status !== "completed") {
    throw new Error("completed probe did not persist completed status");
  }

  const latest = requireProbe(
    await readJson<ProbeResponse>("/data-client/runs/latest", authed()),
    "latest probe",
  );
  if (
    latest.runId !== runId ||
    latest.status !== "completed" ||
    latest.scope?.userId !== "fixture-user" ||
    latest.scope?.workspaceId !== "fixture-workspace"
  ) {
    throw new Error("latest probe did not preserve fixture tenant-scoped completed state");
  }

  console.log("Cloudflare control-plane smoke passed");
  console.log(
    JSON.stringify(
      {
        runId: latest.runId,
        status: latest.status,
        scope: latest.scope,
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
