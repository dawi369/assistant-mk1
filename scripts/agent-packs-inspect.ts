import {
  formatAgentPackIssues,
  inspectAgentPackForDeveloperLoop,
} from "../lib/workbench/agent-pack-dev-loop";

const readArg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const packId = readArg("--pack");
const json = process.argv.includes("--json");

if (!packId) {
  console.error("Usage: pnpm agent-packs:inspect --pack <pack-id> [--json]");
  process.exit(1);
}

const result = inspectAgentPackForDeveloperLoop(packId);

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else if (!result.ok) {
  console.log(formatAgentPackIssues(result.errors));
} else {
  console.log(`${result.pack.name} (${result.pack.id})`);
  console.log(`template: ${result.pack.templateId}`);
  console.log(`capability: ${result.pack.capabilityLevel}`);
  console.log(`prompt: ${result.pack.promptPath}`);
  console.log(
    `risk: financialData=${result.pack.risk.financialData} externalMutation=${result.pack.risk.externalMutation} requiresSecrets=${result.pack.risk.requiresSecrets} gate=${result.pack.risk.productionGate}`,
  );
  console.log(`ui: ${result.pack.ui.primarySurface} / ${result.pack.ui.configurationMode}`);
  console.log("tools:");
  for (const tool of result.tools) {
    console.log(
      `- ${tool.id}: ${tool.registered ? "registered" : "missing"}${tool.policyReference ? ` (${tool.policyReference})` : ""}`,
    );
  }
  console.log("workflows:");
  if (!result.workflows.length) {
    console.log("- none");
  }
  for (const workflow of result.workflows) {
    console.log(
      `- ${workflow.type}: ${workflow.registered ? "registered" : "missing"}${workflow.workerRoute ? ` worker=${workflow.workerRoute}` : ""}${workflow.vercelRoute ? ` vercel=${workflow.vercelRoute}` : ""}`,
    );
  }
  console.log("smoke scenarios:");
  for (const scenario of result.pack.smokeScenarios) {
    console.log(`- ${scenario.id}: ${scenario.prompt}`);
  }
  const packWarnings = result.validation.warnings.filter((item) => item.packId === result.pack.id);
  if (packWarnings.length) console.log(formatAgentPackIssues(packWarnings));
}

if (!result.ok) process.exit(1);
