import {
  assertSchemaValue,
  defaultActionPort,
  defaultConnectionPort,
  type AgentExecutionContext,
  type RuntimeResult,
  type RuntimeToolBinding,
  type RuntimeWorkflowBinding,
} from "@assistant-mk1/agent-sdk";

import { loadAgentModules } from "./agent-pack-compiler";
import { createAgentPackTestFetch } from "./agent-pack-test-fetch";

const readArg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const run = async () => {
  const requested = readArg("--pack");
  if (!requested) throw new Error("Usage: pnpm agent-packs:test --pack <pack-id>");
  const modules = await loadAgentModules(process.cwd());
  const loaded = modules.find(
    (item) => item.manifest.id === requested || item.entry.package === requested,
  );
  if (!loaded) throw new Error(`Agent pack ${requested} is not configured.`);

  const results: Array<{ id: string; ok: boolean; summary: string }> = [];
  for (const health of loaded.controlPlane.health) {
    const result = await health.check();
    results.push({ id: `health.${health.id}`, ...result });
  }
  for (const evaluation of loaded.controlPlane.evals) {
    const result = await evaluation.run();
    results.push({ id: `eval.${evaluation.id}`, ...result });
  }

  const workflow = loaded.controlPlane.workflows.find(
    (candidate) => typeof candidate.execute === "function",
  ) as RuntimeWorkflowBinding | undefined;
  if (workflow?.execute) {
    let stateVersion = 0;
    let toolCalls = 0;
    const controller = new AbortController();
    const invoke = async (
      toolId: string,
      input: Record<string, unknown>,
    ): Promise<RuntimeResult> => {
      toolCalls += 1;
      const controlPlaneTool = loaded.controlPlane.tools.find(
        (candidate) => candidate.id === toolId,
      );
      const runnerTool = loaded.runner.tools.find((candidate) => candidate.id === toolId);
      const tool = (
        controlPlaneTool?.execute ? controlPlaneTool : (runnerTool ?? controlPlaneTool)
      ) as RuntimeToolBinding | undefined;
      if (!tool?.execute) {
        return {
          ok: false,
          error: {
            code: "tool_binding_unavailable",
            message: `${toolId} is not executable.`,
            redacted: true,
          },
          summary: `${toolId} is not executable.`,
        };
      }
      assertSchemaValue(tool.inputSchema, input, `${toolId} input`);
      const result = await tool.execute(input, context);
      if (result.ok) assertSchemaValue(tool.outputSchema, result.output, `${toolId} output`);
      return result;
    };
    const context: AgentExecutionContext = {
      scope: { userId: "conformance-user", workspaceId: "tenant-a", agentId: "agent-a" },
      pack: {
        id: loaded.manifest.id,
        version: loaded.manifest.version,
        runtimeVersion: loaded.controlPlane.runtimeVersion,
      },
      run: {
        id: "conformance-run",
        workflowIntentId: "conformance-intent",
        executionMode: "dry_run",
        source: "user",
      },
      signal: controller.signal,
      connections: defaultConnectionPort(loaded.manifest.connections),
      actions: defaultActionPort,
      tools: { invoke },
      managedState: {
        async upsert(input) {
          if ((input.expectedVersion ?? 0) !== stateVersion) {
            throw Object.assign(new Error("Managed-state compare-and-set conflict."), {
              code: "managed_state_version_conflict",
            });
          }
          stateVersion += 1;
          return { id: "conformance-state", version: stateVersion };
        },
      },
      events: { async append() {} },
    };
    const input = Object.fromEntries(
      Object.entries(
        (workflow.inputSchema.properties ?? {}) as Record<string, Record<string, unknown>>,
      )
        .filter(([, schema]) => schema.default !== undefined)
        .map(([key, schema]) => [key, schema.default]),
    );
    assertSchemaValue(workflow.inputSchema, input, `${workflow.type} input`);
    const output = await workflow.execute(input, context);
    if (!output.ok) throw new Error(output.error.message);
    assertSchemaValue(workflow.outputSchema, output.output, `${workflow.type} output`);
    if (toolCalls > loaded.manifest.resourceLimits.maxToolCallsPerRun) {
      throw new Error("Workflow exceeded its declared tool-call limit.");
    }
    results.push({
      id: `workflow.${workflow.type}`,
      ok: true,
      summary: output.summary,
    });
  }

  for (const connection of loaded.manifest.connections.filter(
    (candidate) => candidate.credentialClass !== "none",
  )) {
    const capability = await defaultConnectionPort(loaded.manifest.connections).resolve(
      connection.id,
      connection.toolIds[0] ?? "",
    );
    if (capability.status !== "authorization_required") {
      throw new Error(`${connection.id} must default to authorization_required.`);
    }
    results.push({
      id: `connection.${connection.id}`,
      ok: true,
      summary: capability.reason,
    });
  }
  await defaultActionPort.execute("not-authorized").then(
    () => {
      throw new Error("Action execution unexpectedly succeeded.");
    },
    (error: unknown) => {
      if (
        !error ||
        typeof error !== "object" ||
        !("code" in error) ||
        error.code !== "mutation_disabled"
      ) {
        throw error;
      }
    },
  );
  results.push({
    id: "action.mutation-disabled",
    ok: true,
    summary: "External mutation remains disabled.",
  });

  const failed = results.filter((result) => !result.ok);
  console.log(
    JSON.stringify(
      {
        ok: failed.length === 0,
        packId: loaded.manifest.id,
        packVersion: loaded.manifest.version,
        runtimeVersion: loaded.controlPlane.runtimeVersion,
        results,
      },
      null,
      2,
    ),
  );
  if (failed.length) process.exit(1);
};

const main = async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = createAgentPackTestFetch();
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
