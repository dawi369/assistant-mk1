import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { renderEnvironmentConfig } from "./render-environment-config";
import {
  environmentTargets,
  loadWorkbenchEnvironment,
  resolveEnvironmentReferences,
  validateEnvironmentSet,
  validateEnvironmentSecretValues,
} from "./workbench-environment";

describe("workbench environment manifests", () => {
  it("keeps local, acceptance, and production resources and secret references distinct", () => {
    expect(validateEnvironmentSet(environmentTargets.map(loadWorkbenchEnvironment))).toEqual([]);
  });

  it("keeps production fail-closed", () => {
    const production = loadWorkbenchEnvironment("production");
    expect(production.conformanceMode).toBe(false);
    expect(production.vaultBackend).toBe("workos");
    expect(production.mutationDefaultEnabled).toBe(false);
  });

  it("reports unresolved target metadata without exposing values", () => {
    const acceptance = loadWorkbenchEnvironment("acceptance");
    const result = resolveEnvironmentReferences(acceptance, {} as NodeJS.ProcessEnv);
    expect(result.unresolved).toContain("WORKBENCH_ACCEPTANCE_D1_DATABASE_ID");
    expect(result.manifest.cloudflare.d1DatabaseId).toBe("${WORKBENCH_ACCEPTANCE_D1_DATABASE_ID}");
  });

  it("requires long role-distinct, target-distinct hosted secrets", () => {
    const acceptance = loadWorkbenchEnvironment("acceptance");
    const production = loadWorkbenchEnvironment("production");
    const source = {} as NodeJS.ProcessEnv;
    for (const [index, variable] of Object.values(
      acceptance.secretEnvironmentVariables,
    ).entries()) {
      source[variable] = `acceptance-${index}-${"a".repeat(40)}`;
    }
    for (const [index, variable] of Object.values(
      production.secretEnvironmentVariables,
    ).entries()) {
      source[variable] = `production-${index}-${"b".repeat(40)}`;
    }
    expect(validateEnvironmentSecretValues([acceptance, production], source)).toEqual([]);
    source[production.secretEnvironmentVariables.runnerSigning] =
      source[acceptance.secretEnvironmentVariables.runnerSigning];
    expect(validateEnvironmentSecretValues([acceptance, production], source)).toContain(
      "production runnerSigning secret is shared with acceptance runnerSigning",
    );
  });

  it("renders a target-scoped Worker and repository-root Fly build without secrets", () => {
    const variables = {
      WORKBENCH_ACCEPTANCE_D1_DATABASE_ID: "11111111-1111-4111-8111-111111111111",
      WORKBENCH_ACCEPTANCE_CLOUDFLARE_ORIGIN: "https://control.acceptance.example.test",
      WORKBENCH_ACCEPTANCE_FLY_ORIGIN: "https://runner.acceptance.example.test",
      WORKBENCH_ACCEPTANCE_VERCEL_ORG_ID: "team_acceptance",
      WORKBENCH_ACCEPTANCE_VERCEL_PROJECT_ID: "project_acceptance",
      WORKBENCH_ACCEPTANCE_VERCEL_ORIGIN: "https://workbench.acceptance.example.test",
      WORKBENCH_ACCEPTANCE_WORKOS_APPLICATION_ID: "client_acceptance",
      WORKBENCH_ACCEPTANCE_WORKSPACE_ID: "workspace_acceptance",
    };
    const previous = Object.fromEntries(
      Object.keys(variables).map((key) => [key, process.env[key]]),
    );
    Object.assign(process.env, variables);
    try {
      const rendered = renderEnvironmentConfig("acceptance");
      expect(readFileSync(rendered.flyPath, "utf8")).toContain(
        'dockerfile = "Dockerfile.langgraph"',
      );
      const worker = readFileSync(rendered.wranglerPath, "utf8");
      expect(worker).toContain("assistant-mk1-acceptance-control-plane");
      expect(worker).not.toContain("WORKBENCH_ACCEPTANCE_RUNNER_SIGNING_SECRET");
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("enforces ordered feature stages and keeps production mutation-disabled", () => {
    const variables = {
      WORKBENCH_ACCEPTANCE_D1_DATABASE_ID: "11111111-1111-4111-8111-111111111111",
      WORKBENCH_ACCEPTANCE_CLOUDFLARE_ORIGIN: "https://control.acceptance.example.test",
      WORKBENCH_ACCEPTANCE_FLY_ORIGIN: "https://runner.acceptance.example.test",
      WORKBENCH_ACCEPTANCE_VERCEL_ORG_ID: "team_acceptance",
      WORKBENCH_ACCEPTANCE_VERCEL_PROJECT_ID: "project_acceptance",
      WORKBENCH_ACCEPTANCE_VERCEL_ORIGIN: "https://workbench.acceptance.example.test",
      WORKBENCH_ACCEPTANCE_WORKOS_APPLICATION_ID: "client_acceptance",
      WORKBENCH_ACCEPTANCE_WORKSPACE_ID: "workspace_acceptance",
    };
    const previous = Object.fromEntries(
      Object.keys(variables).map((key) => [key, process.env[key]]),
    );
    Object.assign(process.env, variables);
    try {
      const connections = readFileSync(
        renderEnvironmentConfig("acceptance", { featureStage: "connections" }).wranglerPath,
        "utf8",
      );
      expect(connections).toContain('"WORKBENCH_RETAINED_DATA_ENABLED": "true"');
      expect(connections).toContain('"WORKBENCH_CONNECTIONS_ENABLED": "true"');
      expect(connections).toContain('"WORKBENCH_MUTATIONS_ENABLED": "false"');
      expect(() => renderEnvironmentConfig("production", { featureStage: "mutations" })).toThrow(
        "production deployment cannot globally enable mutations",
      );
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
