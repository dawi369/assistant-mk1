import {
  formatAgentPackIssues,
  smokeAgentPackForDeveloperLoop,
} from "../lib/workbench/agent-pack-dev-loop";

const readArg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const packId = readArg("--pack");
const json = process.argv.includes("--json");

if (!packId) {
  console.error("Usage: pnpm agent-packs:smoke --pack <pack-id> [--json]");
  process.exit(1);
}

const result = smokeAgentPackForDeveloperLoop(packId);

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else if (!result.ok) {
  console.log(`Agent pack smoke failed: ${packId}`);
  console.log(formatAgentPackIssues(result.errors));
} else {
  console.log(`Agent pack smoke ok: ${result.packId}`);
  console.log(`template mapped: ${result.templateId}`);
  console.log("snapshot mapped: true");
  if (result.nextCommands.length) {
    console.log("optional live smoke commands:");
    for (const command of result.nextCommands) console.log(`- ${command}`);
  }
  if (result.warnings.length) console.log(formatAgentPackIssues(result.warnings));
}

if (!result.ok) process.exit(1);
