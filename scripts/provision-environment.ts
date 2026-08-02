import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { isEnvironmentTarget, loadWorkbenchEnvironment } from "./workbench-environment";

const providers = ["cloudflare", "fly", "vercel", "workos"] as const;
type Provider = (typeof providers)[number];
const valueAfter = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const git = (...args: string[]) => {
  const result = spawnSync("git", args, { cwd: process.cwd(), encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed`);
  return result.stdout.trim();
};

const target = valueAfter("--target") ?? "";
const providerValue = valueAfter("--provider") ?? "";
const execute = process.argv.includes("--execute");
if (!isEnvironmentTarget(target) || target === "local") {
  throw new Error("--target must be acceptance|production");
}
if (!providers.includes(providerValue as Provider)) {
  throw new Error(`--provider must be ${providers.join("|")}`);
}
const provider = providerValue as Provider;
const manifest = loadWorkbenchEnvironment(target);
const commit = git("rev-parse", "HEAD");
const confirmation = `${target}:provision-${provider}:${commit}`;
const descriptions: Record<Provider, string[]> = {
  cloudflare: [
    `D1 database ${manifest.cloudflare.d1DatabaseName}`,
    `R2 bucket ${manifest.cloudflare.r2BucketName}`,
    `Worker and Durable Object namespace ${manifest.cloudflare.workerName} (created on first deploy)`,
  ],
  fly: [`Fly application ${manifest.fly.appName}`],
  vercel: [`Vercel project ${manifest.vercel.projectName}`],
  workos: [
    `AuthKit application ${manifest.workos.applicationName}`,
    `${target === "acceptance" ? "synthetic acceptance" : "isolated production acceptance"} organization/workspace`,
  ],
};

if (!execute) {
  console.log(`Dry run only: provision ${target} ${provider} at ${commit}.`);
  descriptions[provider].forEach((description) => console.log(`- ${description}`));
  console.log(`Re-run with --execute --confirm ${confirmation} after approval is recorded.`);
  if (provider === "workos") {
    console.log(
      "WorkOS AuthKit application and organization provisioning remains a dashboard operation.",
    );
  }
  process.exit(0);
}
if (valueAfter("--confirm") !== confirmation) {
  throw new Error(`provisioning requires --confirm ${confirmation}`);
}
if (git("status", "--porcelain")) throw new Error("hosted provisioning requires a clean worktree");
if (provider === "workos") {
  throw new Error(
    "WorkOS AuthKit application provisioning is not automated; complete the dashboard checklist and record same-commit evidence with release:evidence:record",
  );
}

const commands: Record<Exclude<Provider, "workos">, Array<[string, string[]]>> = {
  cloudflare: [
    ["pnpm", ["exec", "wrangler", "d1", "create", manifest.cloudflare.d1DatabaseName]],
    ["pnpm", ["exec", "wrangler", "r2", "bucket", "create", manifest.cloudflare.r2BucketName]],
  ],
  fly: [["fly", ["apps", "create", manifest.fly.appName]]],
  vercel: [["vercel", ["project", "add", manifest.vercel.projectName, "--yes"]]],
};
const commandEvidence: Array<{ command: string; status: "created" }> = [];
for (const [command, args] of commands[provider]) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.slice(0, 3).join(" ")} exited with ${result.status}`);
  }
  commandEvidence.push({ command: [command, ...args].join(" "), status: "created" });
}
const directory = resolve(process.cwd(), "output/release", commit);
mkdirSync(directory, { recursive: true });
const evidencePath = resolve(directory, `provision-${target}-${provider}.json`);
writeFileSync(
  evidencePath,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      target,
      commit,
      provider,
      status: "provisioned",
      resources: descriptions[provider],
      commands: commandEvidence,
      completedAt: new Date().toISOString(),
      operator: process.env.WORKBENCH_RELEASE_OPERATOR?.trim() || process.env.USER || "unknown",
      followUp:
        "Record provider resource IDs in protected target variables before rendering or deploying.",
    },
    null,
    2,
  )}\n`,
  { mode: 0o600 },
);
console.log(`Provisioned ${target} ${provider}; evidence written to ${evidencePath}.`);
