import { relative } from "node:path";

import { compileAgentPacks } from "./agent-pack-compiler";

const main = async () => {
  const root = process.cwd();
  const check = process.argv.includes("--check");
  const result = await compileAgentPacks(root, { check });
  console.log(
    `Agent runtime registries ${check ? "verified" : "compiled"}: ${result.modules.length} packages, ${result.files.length} files.`,
  );
  for (const file of result.files) console.log(`- ${relative(root, file)}`);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
