import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const walk = (directory: string): string[] =>
  readdirSync(join(root, directory)).flatMap((name) => {
    const path = join(directory, name);
    return statSync(join(root, path)).isDirectory() ? walk(path) : [path];
  });

describe("runtime extension architecture", () => {
  it("keeps executable runner registries outside the Worker graph", () => {
    const workerSources = walk("cloudflare/control-plane/src").filter(
      (path) => path.endsWith(".ts") && !path.endsWith("runtime-architecture.test.ts"),
    );
    for (const path of workerSources) {
      const source = read(path);
      expect(source, path).not.toMatch(/generated\/agent-runtime\/runner/);
      expect(source, path).not.toMatch(/core-runner-provider/);
    }
  });

  it("keeps gateway and Admin/model dispatch generic", () => {
    const gateway = read("scripts/langgraph-runtime-gateway.ts");
    const dispatchers = [
      read("cloudflare/control-plane/src/runtime-admin-tool.ts"),
      read("cloudflare/control-plane/src/runtime-admin-execution.ts"),
      read("cloudflare/control-plane/src/model-tools.ts"),
    ];
    for (const concreteToolId of ["repo.snapshot", "url.inspect", "polymarket.market.search"]) {
      expect(gateway).not.toContain(concreteToolId);
      for (const dispatcher of dispatchers) expect(dispatcher).not.toContain(concreteToolId);
    }
  });

  it("has no obsolete runtime routes or compatibility registries", () => {
    const obsolete = [
      "cloudflare/control-plane/src/core-workflow-provider.ts",
      "cloudflare/control-plane/src/generic-workflow-kernel.ts",
      "cloudflare/control-plane/src/demo-run-store.ts",
      "cloudflare/control-plane/src/demo-runs.ts",
      "lib/workbench/tool-registry.ts",
      "lib/workbench/demo-tool.ts",
      "app/api/workbench/cloudflare-demo-runs/route.ts",
      "app/api/workbench/executors/demo-inspect/route.ts",
    ];
    expect(obsolete.filter((path) => existsSync(join(root, path)))).toEqual([]);
    expect(read("cloudflare/control-plane/src/index.ts")).not.toContain(
      "/internal/workbench/run-callbacks",
    );
  });

  it("keeps extension execution modules bounded", () => {
    const modules = [
      ...walk("cloudflare/control-plane/src"),
      "scripts/langgraph-runtime-gateway.ts",
    ].filter((path) =>
      /(?:runtime|tool-(?:execution|approvals|policy-admin)|langgraph-runtime-gateway)\.ts$/.test(
        relative(root, join(root, path)),
      ),
    );
    for (const path of modules) {
      expect(read(path).split("\n").length, path).toBeLessThanOrEqual(1_200);
    }
  });

  it("keeps credential values out of durable schemas and Fly envelopes", () => {
    for (const path of [
      "cloudflare/control-plane/schema.sql",
      ...walk("cloudflare/control-plane/migrations").filter((entry) => entry.endsWith(".sql")),
    ]) {
      expect(read(path), path).not.toMatch(
        /\b(access_token|refresh_token|client_secret|api_key_value|credential_value)\b/i,
      );
    }
    const gateway = read("scripts/langgraph-runtime-gateway.ts");
    expect(gateway).not.toMatch(/accessToken\??:|refreshToken\??:|apiKey\??:|credential\??:/);
    const runnerInvocation = read("cloudflare/control-plane/src/tool-runner.ts");
    expect(runnerInvocation).toContain("connectionCapability");
    expect(runnerInvocation).not.toMatch(
      /accessToken\??:|refreshToken\??:|apiKey\??:|clientSecret\??:/,
    );
    expect(read("cloudflare/control-plane/migrations/0009_connection_capabilities.sql")).toContain(
      "token_sha256",
    );
    expect(
      read("cloudflare/control-plane/migrations/0009_connection_capabilities.sql"),
    ).not.toMatch(/credential|access_token|refresh_token/i);
  });

  it("retains only a non-identifying receipt after final workspace purge", () => {
    const lifecycle = read("cloudflare/control-plane/src/workspace-data-lifecycle.ts");
    const broker = read("cloudflare/control-plane/src/connection-broker.ts");
    expect(lifecycle).toContain("INSERT INTO control_deletion_receipts");
    expect(lifecycle).toContain("DELETE FROM workspaces WHERE id = ? AND status = 'purging'");
    expect(lifecycle).toContain("DELETE FROM ${table} WHERE workspace_id = ?");
    expect(lifecycle).not.toContain("DELETE FROM ${table} WHERE user_id = ?");
    expect(broker).toContain(
      "FROM control_connections WHERE workspace_id = ? AND status <> 'revoked'",
    );
    expect(lifecycle).not.toContain("name = 'Deleted workspace'");
    expect(
      read("cloudflare/control-plane/migrations/0010_nonidentifying_deletion_receipts.sql"),
    ).not.toMatch(/user_id|workspace_id|account_id|email|name/i);
  });
});
