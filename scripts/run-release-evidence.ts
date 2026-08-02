import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { isEnvironmentTarget } from "./workbench-environment";

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
const kind = valueAfter("--kind")?.trim() ?? "";
const separator = process.argv.indexOf("--");
const command = separator >= 0 ? process.argv.slice(separator + 1) : [];
if (!isEnvironmentTarget(target)) throw new Error("--target is required");
if (!/^[a-z0-9][a-z0-9.-]{1,80}$/.test(kind)) throw new Error("--kind is invalid");
if (!command.length) throw new Error("a command is required after --");
if (command.some((value) => /(?:token|secret|password|api[-_]?key)=/i.test(value))) {
  throw new Error("release evidence commands cannot contain inline credential assignments");
}

const commit = git("rev-parse", "HEAD");
if (git("status", "--porcelain")) throw new Error("release evidence requires a clean worktree");
const releaseDirectory = resolve(process.cwd(), "output/release", commit);
const filesBefore = new Set(existsSync(releaseDirectory) ? readdirSync(releaseDirectory) : []);
const startedAt = new Date();
const result = spawnSync(command[0]!, command.slice(1), {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
});
const completedAt = new Date();
const directory = resolve(releaseDirectory, "records");
mkdirSync(directory, { recursive: true });
const artifactPaths = (existsSync(releaseDirectory) ? readdirSync(releaseDirectory) : [])
  .filter((name) => name !== "records" && !filesBefore.has(name))
  .map((name) => `output/release/${commit}/${name}`)
  .sort();
const record = {
  schemaVersion: 1,
  target,
  commit,
  kind,
  command,
  operator: process.env.WORKBENCH_RELEASE_OPERATOR?.trim() || process.env.USER || "unknown",
  startedAt: startedAt.toISOString(),
  completedAt: completedAt.toISOString(),
  durationMs: completedAt.getTime() - startedAt.getTime(),
  status: result.status === 0 ? "passed" : "failed",
  exitCode: result.status,
  artifactPaths,
};
const path = resolve(directory, `${startedAt.toISOString().replace(/[:.]/g, "-")}-${kind}.json`);
writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
console.log(`Recorded ${kind} evidence at ${path}.`);
process.exitCode = result.status ?? 1;
