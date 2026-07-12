import { rmSync } from "node:fs";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const stateDirectory = resolve(repositoryRoot, "output/playwright/state");
const expectedPrefix = `${resolve(repositoryRoot, "output/playwright")}/`;

if (!stateDirectory.startsWith(expectedPrefix)) {
  throw new Error("Refusing to remove Playwright state outside the repository output directory.");
}

rmSync(stateDirectory, { force: true, recursive: true });
