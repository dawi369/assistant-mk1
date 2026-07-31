import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const run = (command: string, args: string[], cwd: string) => {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", env: process.env });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed: ${result.stderr || result.stdout || "unknown error"}`,
    );
  }
  return result.stdout;
};

const main = () => {
  const root = process.cwd();
  const output = resolve(root, "output/sdk-consumer");
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  run("pnpm", ["pack", "--pack-destination", output], resolve(root, "packages/agent-sdk"));
  const archive = readdirSync(output).find((file) => file.endsWith(".tgz"));
  if (!archive) throw new Error("SDK pack did not produce an archive.");
  run("tar", ["-xzf", archive], output);
  writeFileSync(
    resolve(output, "consumer.ts"),
    `import { defineAgentPack } from "@assistant-mk1/agent-sdk/manifest";
import { defineControlPlaneModule } from "@assistant-mk1/agent-sdk/control-plane";
import { defineRunnerModule } from "@assistant-mk1/agent-sdk/runner";
import { defineWebModule } from "@assistant-mk1/agent-sdk/web";

void defineAgentPack;
void defineControlPlaneModule;
void defineRunnerModule;
void defineWebModule;
`,
  );
  writeFileSync(
    resolve(output, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          noEmit: true,
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          baseUrl: ".",
          paths: {
            "@assistant-mk1/agent-sdk": ["package/src/index.ts"],
            "@assistant-mk1/agent-sdk/*": ["package/src/*"],
          },
          types: [],
          skipLibCheck: true,
        },
        include: ["consumer.ts", "package/src/**/*.ts"],
      },
      null,
      2,
    )}\n`,
  );
  run("pnpm", ["exec", "tsc", "-p", resolve(output, "tsconfig.json")], root);
  console.log(
    `Agent SDK archive and zero-context consumer verified: output/sdk-consumer/${archive}`,
  );
};

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
