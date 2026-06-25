import {
  formatAgentPackIssues,
  validateAgentPacksForDeveloperLoop,
} from "../lib/workbench/agent-pack-dev-loop";

const json = process.argv.includes("--json");
const result = validateAgentPacksForDeveloperLoop();

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`Agent packs: ${result.ok ? "ok" : "failed"} (${result.packCount} checked)`);
  if (result.errors.length) console.log(formatAgentPackIssues(result.errors));
  if (result.warnings.length) console.log(formatAgentPackIssues(result.warnings));
}

if (!result.ok) process.exit(1);
