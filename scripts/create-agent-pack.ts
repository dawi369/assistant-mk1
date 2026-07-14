import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  registerAgentPackSource,
  renderAgentPackIndex,
  renderAgentPackPrompt,
  validateAgentPackScaffoldInput,
} from "../lib/workbench/agent-pack-scaffold";

const readArg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const id = readArg("--id") ?? "";
const name = readArg("--name") ?? "";
const dryRun = process.argv.includes("--dry-run");
const input = validateAgentPackScaffoldInput({ id, name });
const root = process.cwd();
const packDirectory = resolve(root, "agent-packs", input.id);
const registryPath = resolve(root, "agent-packs/index.ts");
if (existsSync(packDirectory))
  throw new Error(`Agent Pack directory already exists: ${packDirectory}`);

const indexSource = renderAgentPackIndex(input);
const promptSource = `${renderAgentPackPrompt(input.name)}\n`;
const registrySource = registerAgentPackSource(readFileSync(registryPath, "utf8"), input.id);

if (dryRun) {
  console.log(
    `Would create agent-packs/${input.id}/index.ts and prompt.xml and register the pack.`,
  );
  process.exit(0);
}

try {
  mkdirSync(packDirectory);
  writeFileSync(join(packDirectory, "index.ts"), indexSource, { flag: "wx" });
  writeFileSync(join(packDirectory, "prompt.xml"), promptSource, { flag: "wx" });
  writeFileSync(registryPath, registrySource);
} catch (error) {
  rmSync(packDirectory, { recursive: true, force: true });
  throw error;
}

console.log(`Created and registered Agent Pack ${input.id}.`);
console.log(`Next: pnpm agent-packs:validate && pnpm agent-packs:inspect --pack ${input.id}`);
