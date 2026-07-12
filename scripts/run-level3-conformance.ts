import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  level3ConformanceSuites,
  missingLevel3Guarantees,
} from "../lib/workbench/level3-conformance";

type SuiteResult = {
  id: string;
  command: string;
  durationMs: number;
  status: "passed" | "failed";
  exitCode: number;
  guarantees: string[];
};

const runCommand = (command: string) =>
  new Promise<number>((resolve) => {
    const child = spawn(command, {
      cwd: process.cwd(),
      env: process.env,
      shell: true,
      stdio: "inherit",
    });
    child.once("error", () => resolve(1));
    child.once("exit", (code) => resolve(code ?? 1));
  });

const main = async () => {
  const results: SuiteResult[] = [];
  for (const suite of level3ConformanceSuites) {
    const startedAt = Date.now();
    const exitCode = await runCommand(suite.command);
    results.push({
      id: suite.id,
      command: suite.command,
      durationMs: Date.now() - startedAt,
      status: exitCode === 0 ? "passed" : "failed",
      exitCode,
      guarantees: suite.guarantees,
    });
    if (exitCode !== 0) break;
  }

  const passedSuiteIds = new Set(
    results.filter((result) => result.status === "passed").map((result) => result.id),
  );
  const missingGuarantees = missingLevel3Guarantees(passedSuiteIds);
  const report = {
    version: 1,
    capabilityLevel: 3,
    commit: process.env.GITHUB_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    generatedAt: new Date().toISOString(),
    ok:
      results.length === level3ConformanceSuites.length &&
      results.every((result) => result.status === "passed") &&
      missingGuarantees.length === 0,
    results,
    missingGuarantees,
    failureArtifacts: ["output/playwright", "cloudflare/control-plane/.wrangler/logs"],
  };
  const outputDirectory = path.join(process.cwd(), "output", "conformance");
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    path.join(outputDirectory, "level3.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
};

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
