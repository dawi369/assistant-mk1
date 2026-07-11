import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dockerIgnore = readFileSync(new URL("../.dockerignore", import.meta.url), "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"));

const requiredExclusions = [
  ".assistant-mk1",
  ".vercel",
  ".playwright-cli",
  ".omm",
  "output",
  "coverage",
  "cloudflare/control-plane/.dev.vars",
  "cloudflare/control-plane/.wrangler",
] as const;

describe("Docker build context policy", () => {
  it("excludes local credentials, state, and generated release artifacts", () => {
    expect(dockerIgnore).toEqual(expect.arrayContaining([...requiredExclusions]));
  });

  it("keeps the public environment template available", () => {
    expect(dockerIgnore).toContain("!.env.example");
  });
});
