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
});
