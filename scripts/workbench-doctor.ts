import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

type Values = Record<string, string>;

const root = process.cwd();
const offline = process.argv.includes("--offline");
const failures: string[] = [];
const checks: string[] = [];

const readEnvFile = (file: string): Values => {
  const absolute = path.join(root, file);
  if (!existsSync(absolute)) {
    failures.push(`${file} is missing`);
    return {};
  }
  const values: Values = {};
  for (const rawLine of readFileSync(absolute, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  checks.push(`${file} loaded`);
  return values;
};

const frontend = { ...readEnvFile(".env.local"), ...process.env } as Values;
const worker = readEnvFile("cloudflare/control-plane/.dev.vars");

const requireValue = (source: Values, key: string, label: string) => {
  if (!source[key]?.trim()) failures.push(`${label} is missing ${key}`);
};

for (const key of [
  "CLOUDFLARE_CONTROL_PLANE_URL",
  "CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN",
  "WORKBENCH_DEV_USER_ID",
  "WORKBENCH_DEV_WORKSPACE_ID",
  "WORKBENCH_DEV_AGENT_ID",
]) {
  requireValue(frontend, key, ".env.local");
}
for (const key of ["CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN", "WORKBENCH_AGENT_CONNECTION_SECRET"]) {
  requireValue(worker, key, "cloudflare/control-plane/.dev.vars");
}
if (frontend.WORKBENCH_ALLOW_LOCAL_DEV_IDENTITY !== "true") {
  failures.push(".env.local must explicitly enable WORKBENCH_ALLOW_LOCAL_DEV_IDENTITY");
}
if (
  frontend.CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN &&
  worker.CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN &&
  frontend.CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN !== worker.CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN
) {
  failures.push("frontend and Worker control-plane tokens do not match");
}
if (worker.WORKBENCH_RUNNER_TRANSPORT === "fly") {
  requireValue(worker, "WORKBENCH_RUNNER_URL", "cloudflare/control-plane/.dev.vars");
  requireValue(worker, "WORKBENCH_RUNNER_SIGNING_SECRET", "cloudflare/control-plane/.dev.vars");
  if (
    frontend.WORKBENCH_RUNNER_SIGNING_SECRET &&
    frontend.WORKBENCH_RUNNER_SIGNING_SECRET !== worker.WORKBENCH_RUNNER_SIGNING_SECRET
  ) {
    failures.push("frontend runner signing secret does not match the Worker runner secret");
  }
}
const alertWebhookUrl = worker.WORKBENCH_OPERATOR_ALERT_WEBHOOK_URL?.trim();
const alertSigningSecret = worker.WORKBENCH_OPERATOR_ALERT_SIGNING_SECRET?.trim();
if (Boolean(alertWebhookUrl) !== Boolean(alertSigningSecret)) {
  failures.push("Worker operator alert webhook URL and signing secret must be configured together");
}
if (alertWebhookUrl) {
  try {
    const url = new URL(alertWebhookUrl);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443")
    ) {
      failures.push(
        "Worker operator alert webhook must use HTTPS on the standard port without credentials in the URL",
      );
    }
  } catch {
    failures.push("Worker operator alert webhook URL is invalid");
  }
}
if (
  frontend.WORKBENCH_OPERATOR_ALERT_SIGNING_SECRET &&
  alertSigningSecret &&
  frontend.WORKBENCH_OPERATOR_ALERT_SIGNING_SECRET !== alertSigningSecret
) {
  failures.push("Vercel and Worker operator alert signing secrets do not match");
}
if (!existsSync(path.join(root, "cloudflare/control-plane/schema.sql"))) {
  failures.push("rebuildable D1 schema is missing");
} else {
  checks.push("rebuildable D1 schema found");
}
const wranglerConfigPath = path.join(root, "cloudflare/control-plane/wrangler.jsonc");
if (!existsSync(wranglerConfigPath)) {
  failures.push("Cloudflare Worker configuration is missing");
} else if (!readFileSync(wranglerConfigPath, "utf8").includes('"binding": "ARTIFACTS"')) {
  failures.push("Cloudflare Worker configuration is missing the ARTIFACTS R2 binding");
} else {
  checks.push("artifact R2 binding declaration found");
}

const runOnlineChecks = async () => {
  if (offline || failures.length > 0) return;
  const origin = frontend.CLOUDFLARE_CONTROL_PLANE_URL.replace(/\/$/, "");
  try {
    const health = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(5_000) });
    if (!health.ok) failures.push(`Worker health returned HTTP ${health.status}`);
    else checks.push("Worker health and D1 query succeeded");

    const workspace = await fetch(`${origin}/workspace-context`, {
      headers: {
        authorization: `Bearer ${frontend.CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN}`,
        "x-assistant-mk1-user-id": frontend.WORKBENCH_DEV_USER_ID,
        "x-assistant-mk1-workspace-id": frontend.WORKBENCH_DEV_WORKSPACE_ID,
        "x-assistant-mk1-agent-id": frontend.WORKBENCH_DEV_AGENT_ID,
        "x-assistant-mk1-account-id": `local-dev:${frontend.WORKBENCH_DEV_WORKSPACE_ID}`,
        "x-assistant-mk1-account-source": "local-dev",
      },
      signal: AbortSignal.timeout(5_000),
    });
    if (!workspace.ok) failures.push(`local identity validation returned HTTP ${workspace.status}`);
    else checks.push("local user, workspace, membership, agent, and preferences validated");
  } catch {
    failures.push("Worker is unreachable; start pnpm dev:cloudflare or use --offline");
  }
};

void runOnlineChecks().then(() => {
  for (const check of checks) console.log(`ok - ${check}`);
  if (failures.length) {
    for (const failure of failures) console.error(`error - ${failure}`);
    process.exitCode = 1;
  } else {
    console.log(offline ? "Workbench configuration is ready (offline)." : "Workbench is ready.");
  }
});
