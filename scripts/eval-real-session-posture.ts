import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  realSessionEvalSuites,
  summarizeRealSessionEvalPosture,
  supportingEvalContractChecks,
} from "../lib/workbench/real-session-evals";

type PackageJson = {
  scripts?: Record<string, string>;
};

const commandScriptName = (command: string) => {
  const match = command.match(/^pnpm\s+([^\s]+)/);
  return match?.[1];
};

const readPackageScripts = async () => {
  const packageJson = JSON.parse(
    await readFile(join(process.cwd(), "package.json"), "utf8"),
  ) as PackageJson;
  return packageJson.scripts ?? {};
};

const main = async () => {
  const scripts = await readPackageScripts();
  const posture = summarizeRealSessionEvalPosture();
  const missingCommands = [...realSessionEvalSuites, ...supportingEvalContractChecks]
    .map((suite) => ({
      id: suite.id,
      command: suite.command,
      script: commandScriptName(suite.command),
    }))
    .filter((suite) => suite.script && !scripts[suite.script]);

  console.log(
    JSON.stringify(
      {
        ok: posture.ok && missingCommands.length === 0,
        realSessionSuites: realSessionEvalSuites.map((suite) => ({
          id: suite.id,
          command: suite.command,
          surface: suite.surface,
          requiredAssertions: suite.requiredAssertions,
        })),
        supportingContractChecks: supportingEvalContractChecks,
        surfaces: posture.surfaces,
        coveredAssertions: posture.coveredAssertions,
        missingAssertions: posture.missingAssertions,
        missingCommands,
      },
      null,
      2,
    ),
  );

  if (!posture.ok || missingCommands.length > 0) {
    process.exitCode = 1;
  }
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
