import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const root = process.cwd();
const output = resolve(root, "output/workbench-client-consumer");
const consumer = resolve(output, "consumer");
const run = (command: string, args: string[], cwd: string) => {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", env: process.env });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
};
const archive = (prefix: string) => {
  const match = readdirSync(output).find(
    (file) => file.startsWith(prefix) && file.endsWith(".tgz"),
  );
  if (!match) throw new Error(`Missing ${prefix} package archive.`);
  return resolve(output, match);
};

rmSync(output, { recursive: true, force: true });
mkdirSync(consumer, { recursive: true });
run("pnpm", ["pack", "--pack-destination", output], resolve(root, "packages/workbench-client"));
run("pnpm", ["pack", "--pack-destination", output], resolve(root, "packages/workbench-react"));
const clientArchive = archive("assistant-mk1-workbench-client-");
const reactArchive = archive("assistant-mk1-workbench-react-");
for (const packageArchive of [clientArchive, reactArchive]) {
  const entries = run("tar", ["-tzf", packageArchive], root).split("\n");
  if (entries.some((entry) => entry.startsWith("package/src/"))) {
    throw new Error("Workbench client packages must execute from dist without source files.");
  }
  if (!entries.includes("package/dist/index.js") || !entries.includes("package/dist/index.d.ts")) {
    throw new Error(
      "Workbench client package archive is missing runtime or declaration entrypoints.",
    );
  }
}

writeFileSync(
  resolve(consumer, "package.json"),
  `${JSON.stringify(
    {
      name: "workbench-client-zero-context-consumer",
      private: true,
      type: "module",
      dependencies: {
        "@assistant-mk1/workbench-client": `file:${relative(consumer, clientArchive)}`,
        "@assistant-mk1/workbench-react": `file:${relative(consumer, reactArchive)}`,
        "@tanstack/react-query": "5.101.4",
        react: "19.2.6",
      },
      pnpm: {
        overrides: {
          "@assistant-mk1/workbench-client": `file:${relative(consumer, clientArchive)}`,
        },
      },
    },
    null,
    2,
  )}\n`,
);
run("pnpm", ["install", "--ignore-workspace", "--offline"], consumer);
writeFileSync(
  resolve(consumer, "consumer.ts"),
  `import { createWorkbenchClient, workbenchChatProtocolVersion } from "@assistant-mk1/workbench-client";
import { createWorkbenchQueryClient, workbenchQueryKeys } from "@assistant-mk1/workbench-react";

const client = createWorkbenchClient({ baseUrl: "https://example.invalid", client: { platform: "ios", version: "test" }, fetch });
void [client, workbenchChatProtocolVersion, createWorkbenchQueryClient(), workbenchQueryKeys.session];
`,
);
writeFileSync(
  resolve(consumer, "tsconfig.json"),
  `${JSON.stringify(
    {
      compilerOptions: {
        strict: true,
        noEmit: true,
        target: "ES2022",
        lib: ["ES2022", "DOM"],
        module: "NodeNext",
        moduleResolution: "NodeNext",
        types: [],
        skipLibCheck: false,
      },
      include: ["consumer.ts"],
    },
    null,
    2,
  )}\n`,
);
run("pnpm", ["exec", "tsc", "-p", "tsconfig.json"], consumer);
const manifest = JSON.parse(
  readFileSync(resolve(root, "packages/workbench-client/package.json"), "utf8"),
) as { name: string };
console.log(`${manifest.name} packed zero-context consumer verified.`);
