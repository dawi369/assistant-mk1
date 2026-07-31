import {
  formatAgentPackIssues,
  validateAgentPacksForDeveloperLoop,
} from "../lib/workbench/agent-pack-dev-loop";
import { loadAgentModules } from "./agent-pack-compiler";

const main = async () => {
  const json = process.argv.includes("--json");
  const result = validateAgentPacksForDeveloperLoop();
  const modules = await loadAgentModules(process.cwd());
  const output = { ...result, packCount: modules.length };
  if (json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(`Agent packs: ${output.ok ? "ok" : "failed"} (${output.packCount} checked)`);
    if (output.errors.length) console.log(formatAgentPackIssues(output.errors));
    if (output.warnings.length) console.log(formatAgentPackIssues(output.warnings));
  }
  if (!output.ok) process.exit(1);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
