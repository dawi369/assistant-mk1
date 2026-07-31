import { toolPolicyCatalog } from "../cloudflare/control-plane/src/tool-policy";
import { packWorkflowBindings } from "../lib/agent-runtime/registry";
import { loadAgentModules } from "./agent-pack-compiler";

const readArg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const main = async () => {
  const packId = readArg("--pack");
  const json = process.argv.includes("--json");
  if (!packId) throw new Error("Usage: pnpm agent-packs:inspect --pack <pack-id> [--json]");
  const loaded = (await loadAgentModules(process.cwd())).find(
    (item) => item.manifest.id === packId || item.entry.package === packId,
  );
  if (!loaded) throw new Error(`Agent pack ${packId} is not configured.`);
  const output = {
    package: loaded.entry.package,
    conformanceOnly: loaded.entry.conformanceOnly === true,
    manifest: loaded.manifest,
    runtime: {
      version: loaded.controlPlane.runtimeVersion,
      compatiblePackVersions: loaded.controlPlane.compatiblePackVersions,
      tools: loaded.manifest.tools.map((tool) => ({
        ...tool,
        registered: Boolean(toolPolicyCatalog[tool.id]),
        policyReference: toolPolicyCatalog[tool.id]?.policyReference,
      })),
      workflows: loaded.manifest.workflows.map((workflow) => {
        const binding = packWorkflowBindings[workflow.type];
        return {
          ...workflow,
          registered: Boolean(binding),
          workerRoute: binding?.workerRoute,
          vercelRoute: binding?.route,
        };
      }),
      health: loaded.controlPlane.health.map((check) => ({
        id: check.id,
        required: check.required,
      })),
      evals: loaded.controlPlane.evals.map((evaluation) => ({
        id: evaluation.id,
        required: evaluation.required,
      })),
      runnerTools: loaded.runner.tools.map((tool) => tool.id),
      artifactRenderers: Object.keys(loaded.web.artifactRenderers),
      managedStateRenderers: Object.keys(loaded.web.managedStateRenderers),
    },
  };
  if (json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }
  console.log(`${loaded.manifest.name} (${loaded.manifest.id})`);
  console.log(
    `package=${loaded.entry.package} packApi=v${loaded.manifest.apiVersion} pack=${loaded.manifest.version} runtime=${loaded.controlPlane.runtimeVersion}`,
  );
  console.log(
    `compatibility=${loaded.controlPlane.compatiblePackVersions} conformanceOnly=${loaded.entry.conformanceOnly === true}`,
  );
  console.log(
    `extensions: tools=${loaded.manifest.tools.length} workflows=${loaded.manifest.workflows.length} state=${loaded.manifest.managedState.length} triggers=${loaded.manifest.triggers.length} renderers=${loaded.manifest.artifactRenderers.length} health=${loaded.manifest.healthChecks.length} evals=${loaded.manifest.evals.length}`,
  );
  for (const workflow of output.runtime.workflows) {
    console.log(
      `- workflow ${workflow.type}: ${workflow.registered ? "runnable" : "missing"} ${workflow.vercelRoute ?? ""}`,
    );
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
