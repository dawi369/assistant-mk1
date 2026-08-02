import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { renderEnvironmentConfig } from "./render-environment-config";
import {
  isEnvironmentTarget,
  loadWorkbenchEnvironment,
  validateEnvironmentSecretValues,
} from "./workbench-environment";

const valueAfter = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const git = (...args: string[]) => {
  const result = spawnSync("git", args, { cwd: process.cwd(), encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed`);
  return result.stdout.trim();
};
const runWithInput = (
  command: string,
  args: string[],
  input: string,
  env: NodeJS.ProcessEnv = process.env,
) => {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env,
    input,
    encoding: "utf8",
    stdio: ["pipe", "inherit", "inherit"],
  });
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status ?? "signal"}`);
};

const target = valueAfter("--target") ?? "";
if (!isEnvironmentTarget(target) || target === "local") {
  throw new Error("--target must be acceptance|production");
}
const manifest = loadWorkbenchEnvironment(target);
const execute = process.argv.includes("--execute");
const sha = git("rev-parse", "HEAD");
const confirmation = `${target}:configure-secrets:${sha}`;
const roles = manifest.secretEnvironmentVariables;
const roleValues = Object.fromEntries(
  Object.entries(roles).map(([role, variable]) => [role, process.env[variable]?.trim() ?? ""]),
) as Record<keyof typeof roles, string>;

if (!execute) {
  console.log(`Dry run only: configure ${target} provider secret roles at ${sha}.`);
  console.log(`Required source variables: ${Object.values(roles).join(", ")}.`);
  console.log(`Re-run with --execute --confirm ${confirmation} after approval is recorded.`);
  process.exit(0);
}
if (valueAfter("--confirm") !== confirmation) {
  throw new Error(`execution requires --confirm ${confirmation}`);
}
if (git("status", "--porcelain")) throw new Error("secret configuration requires a clean worktree");
const secretFailures = validateEnvironmentSecretValues([manifest]);
if (secretFailures.length) throw new Error(secretFailures.join("; "));

const rendered = renderEnvironmentConfig(target);
const workerSecrets = {
  CLOUDFLARE_CONTROL_PLANE_FACADE_SIGNING_SECRET: roleValues.facadeSigning,
  WORKBENCH_RUNNER_SIGNING_SECRET: roleValues.runnerSigning,
  WORKBENCH_CALLBACK_SIGNING_SECRET: roleValues.callbackSigning,
  WORKBENCH_AGENT_CONNECTION_SECRET: roleValues.agentConnection,
  WORKBENCH_OPERATOR_ALERT_SIGNING_SECRET: roleValues.operatorAlertSigning,
  LANGGRAPH_UPSTREAM_TOKEN: roleValues.langgraphProxy,
  WORKOS_API_KEY: roleValues.vault,
  OPENROUTER_API_KEY: roleValues.openrouter,
};
for (const [name, value] of Object.entries(workerSecrets)) {
  runWithInput(
    "pnpm",
    ["exec", "wrangler", "secret", "put", name, "--config", rendered.wranglerPath],
    `${value}\n`,
  );
}

runWithInput(
  "fly",
  ["secrets", "import", "--stage", "--app", manifest.fly.appName],
  [
    `WORKBENCH_RUNNER_SIGNING_SECRET=${roleValues.runnerSigning}`,
    `WORKBENCH_CALLBACK_SIGNING_SECRET=${roleValues.callbackSigning}`,
    `LANGGRAPH_PROXY_TOKEN=${roleValues.langgraphProxy}`,
    `OPENROUTER_API_KEY=${roleValues.openrouter}`,
  ].join("\n") + "\n",
);

const vercelEnvironment = {
  CLOUDFLARE_CONTROL_PLANE_FACADE_SIGNING_SECRET: roleValues.facadeSigning,
  WORKBENCH_OPERATOR_ALERT_SIGNING_SECRET: roleValues.operatorAlertSigning,
  WORKOS_API_KEY: roleValues.vault,
  WORKOS_COOKIE_PASSWORD: roleValues.workosCookie,
};
const vercelProcessEnv = {
  ...process.env,
  VERCEL_ORG_ID: manifest.vercel.organizationId,
  VERCEL_PROJECT_ID: manifest.vercel.projectId,
};
for (const [name, value] of Object.entries(vercelEnvironment)) {
  runWithInput(
    "vercel",
    ["env", "add", name, "production", "--force", "--yes", "--sensitive"],
    `${value}\n`,
    vercelProcessEnv,
  );
}
for (const [name, value] of Object.entries({
  WORKOS_CLIENT_ID: manifest.workos.applicationId,
  NEXT_PUBLIC_WORKOS_CLIENT_ID: manifest.workos.applicationId,
  NEXT_PUBLIC_WORKOS_REDIRECT_URI: `${manifest.vercel.origin}/auth/callback`,
  CLOUDFLARE_CONTROL_PLANE_URL: manifest.cloudflare.origin,
  LANGGRAPH_API_URL: manifest.fly.origin,
  NEXT_PUBLIC_LANGGRAPH_ASSISTANT_ID: "agent",
  WORKBENCH_ENVIRONMENT: target,
  WORKBENCH_OPERATOR_ALERT_CONFORMANCE_MODE: String(target === "acceptance"),
})) {
  runWithInput(
    "vercel",
    ["env", "add", name, "production", "--force", "--yes", "--no-sensitive"],
    `${value}\n`,
    vercelProcessEnv,
  );
}
const evidenceDirectory = resolve(process.cwd(), "output/release", sha);
mkdirSync(evidenceDirectory, { recursive: true });
writeFileSync(
  resolve(evidenceDirectory, `secret-configuration-${target}.json`),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      target,
      commit: sha,
      status: "configured",
      fingerprints: Object.fromEntries(
        Object.entries(roleValues).map(([role, value]) => [
          role,
          createHash("sha256").update(value).digest("hex"),
        ]),
      ),
      providers: {
        cloudflare: Object.keys(workerSecrets),
        fly: [
          "WORKBENCH_RUNNER_SIGNING_SECRET",
          "WORKBENCH_CALLBACK_SIGNING_SECRET",
          "LANGGRAPH_PROXY_TOKEN",
          "OPENROUTER_API_KEY",
        ],
        vercel: Object.keys(vercelEnvironment),
      },
      completedAt: new Date().toISOString(),
      operator: process.env.WORKBENCH_RELEASE_OPERATOR?.trim() || process.env.USER || "unknown",
    },
    null,
    2,
  )}\n`,
  { mode: 0o600 },
);
console.log(`Configured ${target} secret roles in Cloudflare, Fly, and Vercel without disclosure.`);
