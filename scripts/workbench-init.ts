import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

import { diagnoseWorkbench } from "./workbench-doctor-core";

type InitOptions = {
  root: string;
  runMigration: boolean;
};

type InitResult = {
  created: string[];
  configured: string[];
  needsProviderKey: boolean;
};

const placeholder = (value: string | undefined) =>
  !value?.trim() || value.trim().startsWith("replace-with-");

const readValue = (source: string, key: string) => {
  const line = source.split(/\r?\n/).find((candidate) => candidate.startsWith(`${key}=`));
  return line?.slice(key.length + 1).trim();
};

const setPlaceholderValue = (source: string, key: string, value: string) => {
  const lines = source.split(/\r?\n/);
  const index = lines.findIndex((line) => line.startsWith(`${key}=`));
  if (index < 0) {
    lines.push(`${key}=${value}`);
    return { source: lines.join("\n"), changed: true };
  }
  if (!placeholder(lines[index]?.slice(key.length + 1))) return { source, changed: false };
  lines[index] = `${key}=${value}`;
  return { source: lines.join("\n"), changed: true };
};

const writeConfiguredFile = (
  absolute: string,
  source: string,
  values: Readonly<Record<string, string>>,
) => {
  let next = source;
  const configured: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    const result = setPlaceholderValue(next, key, value);
    next = result.source;
    if (result.changed) configured.push(key);
  }
  if (next !== source)
    writeFileSync(absolute, next.endsWith("\n") ? next : `${next}\n`, { mode: 0o600 });
  return configured;
};

const sharedValue = (first: string | undefined, second: string | undefined) => {
  if (!placeholder(first)) return first!;
  if (!placeholder(second)) return second!;
  return randomBytes(32).toString("base64url");
};

export const initializeWorkbench = async ({
  root,
  runMigration,
}: InitOptions): Promise<InitResult> => {
  const frontendPath = resolve(root, ".env.local");
  const workerDirectory = resolve(root, "cloudflare/control-plane");
  const workerPath = resolve(workerDirectory, ".dev.vars");
  const created: string[] = [];
  mkdirSync(workerDirectory, { recursive: true });

  if (!existsSync(frontendPath)) {
    copyFileSync(resolve(root, ".env.example"), frontendPath);
    created.push(".env.local");
  }
  if (!existsSync(workerPath)) {
    copyFileSync(resolve(root, "cloudflare/control-plane/.dev.vars.example"), workerPath);
    created.push("cloudflare/control-plane/.dev.vars");
  }

  const frontend = readFileSync(frontendPath, "utf8");
  const worker = readFileSync(workerPath, "utf8");
  const transportToken = sharedValue(
    readValue(frontend, "CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN"),
    readValue(worker, "CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN"),
  );
  const callbackSecret = sharedValue(
    readValue(frontend, "WORKBENCH_CALLBACK_SIGNING_SECRET"),
    readValue(worker, "WORKBENCH_CALLBACK_SIGNING_SECRET"),
  );
  const agentConnectionSecret = sharedValue(
    undefined,
    readValue(worker, "WORKBENCH_AGENT_CONNECTION_SECRET"),
  );
  const configured = [
    ...writeConfiguredFile(frontendPath, frontend, {
      CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN: transportToken,
      WORKBENCH_CALLBACK_SIGNING_SECRET: callbackSecret,
      WORKBENCH_ADMIN_USER_IDS: readValue(frontend, "WORKBENCH_DEV_USER_ID") || "dev-user",
    }).map((key) => `.env.local:${key}`),
    ...writeConfiguredFile(workerPath, worker, {
      CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN: transportToken,
      WORKBENCH_AGENT_CONNECTION_SECRET: agentConnectionSecret,
      WORKBENCH_CALLBACK_SIGNING_SECRET: callbackSecret,
    }).map((key) => `cloudflare/control-plane/.dev.vars:${key}`),
  ];

  if (runMigration) {
    const migration = spawnSync("pnpm", ["db:cloudflare:migrate:local"], {
      cwd: root,
      env: process.env,
      stdio: "inherit",
    });
    if (migration.status !== 0) throw new Error("Local D1 migration failed");
  }

  const result = await diagnoseWorkbench({ root, offline: true, environment: {} });
  const relevantFailures = result.failures.filter((failure) => !failure.startsWith("Node.js 22.x"));
  if (relevantFailures.length) throw new Error(relevantFailures.join("\n"));

  const initializedFrontend = readFileSync(frontendPath, "utf8");
  const initializedWorker = readFileSync(workerPath, "utf8");
  return {
    created,
    configured,
    needsProviderKey:
      placeholder(readValue(initializedFrontend, "OPENROUTER_API_KEY")) ||
      placeholder(readValue(initializedWorker, "OPENROUTER_API_KEY")),
  };
};

const main = async () => {
  const checkOnly = process.argv.includes("--check");
  if (checkOnly) {
    const result = await diagnoseWorkbench({ root: process.cwd(), offline: true });
    for (const check of result.checks) console.log(`ok - ${check}`);
    if (result.failures.length) throw new Error(result.failures.join("\n"));
    console.log("Workbench local setup is ready.");
    return;
  }
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "", 10);
  if (nodeMajor !== 22)
    throw new Error(`Node.js 22.x is required; current runtime is ${process.version}`);
  const result = await initializeWorkbench({
    root: process.cwd(),
    runMigration: !process.argv.includes("--no-migrate"),
  });
  for (const file of result.created) console.log(`created - ${file}`);
  for (const key of result.configured) console.log(`configured - ${key}`);
  if (result.needsProviderKey) {
    console.log(
      "next - set OPENROUTER_API_KEY in .env.local and cloudflare/control-plane/.dev.vars",
    );
  }
  console.log("next - pnpm dev:workbench");
  console.log("next - run pnpm workbench:doctor in another terminal");
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
