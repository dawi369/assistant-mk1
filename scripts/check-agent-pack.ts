import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { loadAgentModules } from "./agent-pack-compiler";

type PackCheckStep = { label: string; script: string; args: string[] };

export const agentPackCheckSteps = (packId: string, localTestPath?: string): PackCheckStep[] => [
  { label: "compiled registry", script: "agent-packs:compile", args: [] },
  { label: "package contracts", script: "agent-packs:validate", args: [] },
  ...(localTestPath
    ? [
        {
          label: "package characterization",
          script: "exec",
          args: ["vitest", "run", localTestPath],
        },
      ]
    : []),
  { label: "runtime inspection", script: "agent-packs:inspect", args: ["--pack", packId] },
  { label: "health, eval, and workflow", script: "agent-packs:test", args: ["--pack", packId] },
];

const readArg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const main = async () => {
  const packId = readArg("--pack");
  if (!packId) throw new Error("Usage: pnpm workbench pack check --pack <pack-id>");
  const loaded = (await loadAgentModules(process.cwd())).find(
    (item) => item.manifest.id === packId || item.entry.package === packId,
  );
  if (!loaded) throw new Error(`Agent Pack ${packId} is not configured.`);
  const candidateTest = loaded.entry.source
    ? resolve(process.cwd(), loaded.entry.source, "control-plane.test.ts")
    : undefined;
  const localTestPath = candidateTest && existsSync(candidateTest) ? candidateTest : undefined;
  for (const step of agentPackCheckSteps(packId, localTestPath)) {
    console.log(`\n[pack:${packId}] ${step.label}`);
    const result = spawnSync("pnpm", ["--silent", step.script, ...step.args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${step.label} failed for ${packId}`);
  }
  console.log(`\nAgent Pack ${packId} passed its focused developer gate.`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
