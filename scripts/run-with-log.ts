import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const main = async () => {
  const [logPath, command, ...args] = process.argv.slice(2);

  if (!logPath || !command) {
    throw new Error("Usage: run-with-log <log-path> <command> [args...]");
  }

  await mkdir(path.dirname(logPath), { recursive: true });
  const log = createWriteStream(logPath, { flags: "w" });
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["inherit", "pipe", "pipe"],
  });

  child.stdout.pipe(process.stdout);
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(process.stderr);
  child.stderr.pipe(log, { end: false });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => child.kill(signal));
  }

  child.once("error", (error) => {
    console.error(error);
    log.end();
    process.exitCode = 1;
  });

  child.once("exit", (code, signal) => {
    log.end(() => {
      if (signal) process.kill(process.pid, signal);
      else process.exitCode = code ?? 1;
    });
  });
};

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
