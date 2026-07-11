import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const sentinelName = `assistant-mk1-docker-sentinel-${randomUUID()}`;
const imageTag = `assistant-mk1:preview-verify-${process.pid}`;
const sentinelPaths = [
  ".assistant-mk1",
  ".vercel",
  ".playwright-cli",
  ".omm",
  "output",
  "coverage",
  "cloudflare/control-plane/.wrangler",
  ".cache",
].map((directory) => path.join(root, directory, sentinelName));
sentinelPaths.push(path.join(root, `${sentinelName}.db`));
sentinelPaths.push(path.join(root, `${sentinelName}.sqlite`));

const run = (command: string, args: string[], input?: { quiet?: boolean }) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: input?.quiet ? "ignore" : "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code ?? "no code"}`));
    });
  });

const main = async () => {
  await run("docker", ["info"], { quiet: true });
  try {
    for (const sentinelPath of sentinelPaths) {
      await mkdir(path.dirname(sentinelPath), { recursive: true });
      await writeFile(sentinelPath, sentinelName, "utf8");
    }
    await run("docker", [
      "build",
      "--pull=false",
      "--tag",
      imageTag,
      "--file",
      "Dockerfile.langgraph",
      ".",
    ]);
    await run("docker", [
      "run",
      "--rm",
      "--entrypoint",
      "sh",
      imageTag,
      "-c",
      `test "$(id -u)" != 0 && test -z "$(find /app -path /app/node_modules -prune -o \\( -name '${sentinelName}*' -o -name '.assistant-mk1' -o -name '.vercel' -o -name '.playwright-cli' -o -name '.omm' -o -name 'output' -o -name 'coverage' -o -name '.wrangler' -o -name '.dev.vars' -o -name '.cache' -o -name '*.db' -o -name '*.db-shm' -o -name '*.db-wal' -o -name '*.sqlite' -o -name '*.sqlite3' \\) -print -quit)"`,
    ]);
    await run("docker", [
      "run",
      "--rm",
      "--entrypoint",
      "pnpm",
      imageTag,
      "exec",
      "tsx",
      "--version",
    ]);
    await run("docker", [
      "run",
      "--rm",
      "--entrypoint",
      "pnpm",
      imageTag,
      "exec",
      "langgraphjs",
      "--help",
    ]);
    console.log("Docker preview image boundary verified.");
  } finally {
    await Promise.all(sentinelPaths.map((sentinelPath) => rm(sentinelPath, { force: true })));
    await run("docker", ["image", "rm", "--force", imageTag], { quiet: true }).catch(() => {});
  }
};

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
