import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type CommandResult = { ok: true; output: string } | { ok: false; output: string };

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wranglerConfig = "cloudflare/control-plane/wrangler.jsonc";
const expectedBucket = "assistant-mk1-dev-artifacts";
const requiredWorkerSecrets = [
  "WORKBENCH_OPERATOR_ALERT_WEBHOOK_URL",
  "WORKBENCH_OPERATOR_ALERT_SIGNING_SECRET",
] as const;
const requiredVercelVariables = ["WORKBENCH_OPERATOR_ALERT_SIGNING_SECRET"] as const;

const run = (command: string, args: string[]): CommandResult => {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, CI: "true", NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  return result.status === 0 ? { ok: true, output } : { ok: false, output };
};

const jsonFromFirstArray = <T>(output: string): T => {
  const start = output.indexOf("[");
  if (start < 0) throw new Error("Expected a JSON array from infrastructure CLI.");
  return JSON.parse(output.slice(start)) as T;
};

const main = () => {
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const dirty = run("git", ["status", "--porcelain"]).output.trim().length > 0;
  const configSource = readFileSync(join(root, wranglerConfig), "utf8");
  const bindingDeclared =
    configSource.includes('"binding": "ARTIFACTS"') &&
    configSource.includes(`"bucket_name": "${expectedBucket}"`);

  const migrationResult = run("pnpm", [
    "exec",
    "wrangler",
    "d1",
    "migrations",
    "list",
    "assistant_mk1_dev",
    "--remote",
    "--config",
    wranglerConfig,
  ]);
  const pendingMigrations = migrationResult.ok
    ? Array.from(migrationResult.output.matchAll(/\b\d{4}_[a-z0-9_]+\.sql\b/g), (match) => match[0])
    : ["migration_status_unavailable"];

  const workerSecretResult = run("pnpm", [
    "exec",
    "wrangler",
    "secret",
    "list",
    "--config",
    wranglerConfig,
  ]);
  const workerSecretNames = workerSecretResult.ok
    ? jsonFromFirstArray<Array<{ name: string }>>(workerSecretResult.output).map(
        (item) => item.name,
      )
    : [];
  const missingWorkerSecrets = requiredWorkerSecrets.filter(
    (name) => !workerSecretNames.includes(name),
  );

  const vercelResult = run("pnpm", ["exec", "vercel", "env", "ls", "production"]);
  const missingVercelVariables = requiredVercelVariables.filter(
    (name) => !vercelResult.ok || !vercelResult.output.includes(name),
  );

  const r2Result = run("pnpm", [
    "exec",
    "wrangler",
    "r2",
    "bucket",
    "list",
    "--config",
    wranglerConfig,
  ]);
  const r2Enabled = r2Result.ok;
  const bucketExists = r2Result.ok && r2Result.output.includes(expectedBucket);
  const r2FailureCode = r2Result.ok
    ? null
    : r2Result.output.includes("code: 10042")
      ? "r2_not_enabled"
      : "r2_status_unavailable";

  const checks = {
    cleanCommitEvidence: !dirty,
    artifactBindingDeclared: bindingDeclared,
    remoteMigrationsCurrent: migrationResult.ok && pendingMigrations.length === 0,
    r2Enabled,
    artifactBucketExists: bucketExists,
    workerAlertConfigurationPresent: missingWorkerSecrets.length === 0,
    vercelAlertReceiverConfigurationPresent: missingVercelVariables.length === 0,
  };
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    commit,
    dirty,
    ok: Object.values(checks).every(Boolean),
    checks,
    details: {
      pendingMigrations,
      expectedBucket,
      r2FailureCode,
      missingWorkerSecrets,
      missingVercelVariables,
    },
    nextActions: [
      ...(!r2Enabled ? ["Enable R2 for the Cloudflare account."] : []),
      ...(r2Enabled && !bucketExists ? [`Create R2 bucket ${expectedBucket}.`] : []),
      ...(pendingMigrations.length
        ? ["Export remote D1, checksum it, then apply pending migrations."]
        : []),
      ...(missingWorkerSecrets.length
        ? ["Configure the Worker alert URL and signing secret."]
        : []),
      ...(missingVercelVariables.length
        ? ["Configure the matching Vercel alert signing secret."]
        : []),
      ...(dirty
        ? ["Commit the verified worktree so hosted evidence can name one immutable SHA."]
        : []),
    ],
  };

  const outputDirectory = join(root, "output", "release", commit.slice(0, 7));
  mkdirSync(outputDirectory, { recursive: true });
  const outputPath = join(outputDirectory, "level3-hosted-preflight.json");
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ ...report, outputPath }, null, 2));
  if (!report.ok) process.exitCode = 1;
};

main();
