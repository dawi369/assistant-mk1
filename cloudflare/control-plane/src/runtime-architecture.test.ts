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
      "app/api/workbench/data-export/route.ts",
    ];
    expect(obsolete.filter((path) => existsSync(join(root, path)))).toEqual([]);
    expect(read("cloudflare/control-plane/src/index.ts")).not.toContain(
      "/internal/workbench/run-callbacks",
    );
    expect(read("cloudflare/control-plane/src/index.ts")).not.toContain(
      'url.pathname === "/workbench/data-export"',
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

  it("purges Durable Object chat storage without starting a model turn", () => {
    const threadAgent = read("cloudflare/control-plane/src/thread-chat-agent.ts");
    const lifecycleRoute = threadAgent.match(
      /if \(url\.pathname === "\/internal\/lifecycle-unfreeze"\)([\s\S]*?)if \(this\.lifecycleFence\(\)/,
    )?.[1];
    expect(lifecycleRoute).toBeDefined();
    expect(lifecycleRoute).toContain("await this.persistMessages([])");
    expect(lifecycleRoute).not.toContain("saveMessages");
  });

  it("enforces snapshot export fences at every exported durable table", () => {
    const lifecycle = read("cloudflare/control-plane/src/workspace-data-lifecycle.ts");
    const schema = read("cloudflare/control-plane/schema.sql");
    const migration = read(
      "cloudflare/control-plane/migrations/0012_consistent_workspace_exports.sql",
    );
    const exportedTables = [
      ...lifecycle.matchAll(/tenantCollection\(\s*"([^"]+)"/g),
      ...lifecycle.matchAll(/name:\s*"(users|workspaces|agents)"/g),
    ].map((match) => match[1]);
    expect(new Set(exportedTables).size).toBe(exportedTables.length);
    const omissionBlock = lifecycle.match(
      /workspaceExportOmittedTables\s*=\s*\[([\s\S]*?)\]\s*as const/,
    )?.[1];
    expect(omissionBlock).toBeDefined();
    const omittedTables = [...(omissionBlock ?? "").matchAll(/"([^"]+)"/g)].map(
      (match) => match[1],
    );
    const workspaceScopedTables = [
      ...schema.matchAll(/CREATE TABLE ([a-z0-9_]+) \(([\s\S]*?)\n\);/g),
    ]
      .filter((match) => /\bworkspace_id\s+TEXT\b/.test(match[2] ?? ""))
      .map((match) => match[1]);
    const coveredTables = new Set([...exportedTables, ...omittedTables]);
    expect(
      workspaceScopedTables.filter((table) => !coveredTables.has(table)),
      "new workspace-scoped tables require an export projection or explicit omission",
    ).toEqual([]);
    for (const table of exportedTables) {
      const actions =
        table === "users" || table === "workspaces"
          ? ["update", "delete"]
          : ["insert", "update", "delete"];
      for (const action of actions) {
        expect(migration, `${table} ${action}`).toContain(
          `CREATE TRIGGER export_fence_${table}_${action}`,
        );
      }
    }
    expect(lifecycle).not.toMatch(/\bOFFSET\b/);
    expect(lifecycle).toContain("ORDER BY collection_name ASC, row_key ASC");
    for (const phase of [
      "awaiting_quiescence",
      "fenced",
      "do_frozen",
      "d1_materialized",
      "r2_pinned",
      "released",
      "assembling",
    ]) {
      expect(lifecycle).toContain(`"${phase}"`);
    }
    expect(lifecycle).toContain("workspace_export_fence_recovery_failed");
  });

  it("keeps hosted targets out of local configs and requires signed callback origins", () => {
    const packageJson = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
    expect(packageJson.scripts?.["db:cloudflare:migrate:remote"]).toBeUndefined();
    expect(packageJson.scripts?.["db:cloudflare:rebuild:remote"]).toBeUndefined();
    expect(read("cloudflare/control-plane/wrangler.jsonc")).not.toMatch(
      /acceptance|production|workers\.dev|fly\.dev|vercel\.app/,
    );
    expect(read("fly.langgraph.toml")).not.toMatch(/acceptance|production|workers\.dev|fly\.dev/);
    const gateway = read("scripts/langgraph-runtime-gateway.ts");
    expect(gateway).toContain("WORKBENCH_CALLBACK_ORIGIN");
    expect(gateway).toContain("callbackUrl.origin !== allowedCallbackOrigin");
    const client = read("lib/workbench/cloudflare-control-plane-client.ts");
    expect(client).toContain("baseUrl && (token || signingSecret)");
    const webhook = read("app/api/external-signals/[publicId]/route.ts");
    expect(webhook).toContain("!baseUrl || !signingSecret");
  });
});
