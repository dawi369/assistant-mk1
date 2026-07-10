import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { localAgentPacks, type LocalAgentPackManifest } from ".";
import {
  inspectAgentPackForDeveloperLoop,
  smokeAgentPackForDeveloperLoop,
  validateAgentPacksForDeveloperLoop,
} from "../lib/workbench/agent-pack-dev-loop";

const rootDir = process.cwd();
const [repoAnalystPack] = localAgentPacks;

const writePackFiles = (
  root: string,
  pack: LocalAgentPackManifest,
  input?: { prompt?: string },
) => {
  mkdirSync(path.join(root, pack.folderPath), { recursive: true });
  writeFileSync(path.join(root, pack.codePath), "export {};\n");
  writeFileSync(path.join(root, pack.promptPath), input?.prompt ?? pack.prompt);
};

const withPack = (input: Partial<LocalAgentPackManifest>): LocalAgentPackManifest => {
  const id = input.id ?? "test-pack";
  return {
    ...repoAnalystPack,
    id,
    templateId: `pack-${id}`,
    folderPath: "agent-packs/test-pack",
    codePath: "agent-packs/test-pack/index.ts",
    promptPath: "agent-packs/test-pack/prompt.xml",
    ...input,
  } as LocalAgentPackManifest;
};

describe("agent pack developer loop", () => {
  it("validates checked-in packs", () => {
    const result = validateAgentPacksForDeveloperLoop({ rootDir });

    expect(result.ok).toBe(true);
    expect(result.packCount).toBe(3);
    expect(result.errors).toEqual([]);
  });

  it("rejects duplicate ids and template ids", () => {
    const duplicate = {
      ...repoAnalystPack,
      id: localAgentPacks[1].id,
      templateId: localAgentPacks[1].templateId,
    } as LocalAgentPackManifest;

    const result = validateAgentPacksForDeveloperLoop({
      rootDir,
      packs: [localAgentPacks[1], duplicate],
    });

    expect(result.ok).toBe(false);
    expect(result.errors.map((item) => item.message).join("\n")).toContain("duplicate");
  });

  it("rejects missing prompt files and prompt mismatch", () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "agent-pack-dev-loop-"));
    const missingPromptPack = withPack({});
    mkdirSync(path.join(tempRoot, missingPromptPack.folderPath), { recursive: true });
    writeFileSync(path.join(tempRoot, missingPromptPack.codePath), "export {};\n");

    const missingPrompt = validateAgentPacksForDeveloperLoop({
      rootDir: tempRoot,
      packs: [missingPromptPack],
    });
    expect(missingPrompt.ok).toBe(false);
    expect(
      missingPrompt.errors.some((item) => item.message.includes("promptPath does not exist")),
    ).toBe(true);

    const mismatchPack = withPack({ id: "mismatch-pack", templateId: "pack-mismatch" });
    const mismatchRoot = mkdtempSync(path.join(tmpdir(), "agent-pack-dev-loop-"));
    writePackFiles(mismatchRoot, mismatchPack, { prompt: "<identity>Different</identity>" });
    const mismatch = validateAgentPacksForDeveloperLoop({
      rootDir: mismatchRoot,
      packs: [mismatchPack],
    });

    expect(mismatch.ok).toBe(false);
    expect(mismatch.errors.some((item) => item.message.includes("prompt.xml must match"))).toBe(
      true,
    );
  });

  it("rejects malformed tools, missing smoke scenarios, secret packs, and unsafe execute mode", () => {
    const unsafePack = withPack({
      tools: [
        {
          ...repoAnalystPack.tools[0],
          id: "bad tool id",
          executionModes: ["execute"],
        },
      ],
      risk: {
        ...repoAnalystPack.risk,
        externalMutation: false,
        requiresSecrets: true,
        productionGate: "none",
      },
      smokeScenarios: [],
    });
    const tempRoot = mkdtempSync(path.join(tmpdir(), "agent-pack-dev-loop-"));
    writePackFiles(tempRoot, unsafePack);

    const result = validateAgentPacksForDeveloperLoop({ rootDir: tempRoot, packs: [unsafePack] });
    const messages = result.errors.map((item) => item.message).join("\n");

    expect(result.ok).toBe(false);
    expect(messages).toContain("cannot require secrets");
    expect(messages).toContain("cannot declare execute without externalMutation");
    expect(messages).toContain("smokeScenarios must include");
    expect(messages).toContain("tool id bad tool id is malformed");
  });

  it("inspects runtime bindings and flags missing bindings without throwing", () => {
    const pack = withPack({
      tools: [
        {
          ...repoAnalystPack.tools[0],
          id: "missing.tool",
        },
      ],
      workflows: [
        {
          type: "missing.workflow",
          engine: "langgraph",
          status: "declared",
          description: "Missing route binding for test.",
        },
      ],
    });
    const tempRoot = mkdtempSync(path.join(tmpdir(), "agent-pack-dev-loop-"));
    writePackFiles(tempRoot, pack);

    const result = inspectAgentPackForDeveloperLoop(pack.id, {
      rootDir: tempRoot,
      packs: [pack],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected inspection success");
    expect(result.tools[0]).toMatchObject({ id: "missing.tool", registered: false });
    expect(result.workflows[0]).toMatchObject({ type: "missing.workflow", registered: false });
    expect(result.validation.warnings).not.toEqual([]);
  });

  it("smokes checked-in packs through template and snapshot mapping", () => {
    const result = smokeAgentPackForDeveloperLoop("baby-polymancer", { rootDir });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected smoke success");
    expect(result.templateId).toBe("pack-baby-polymancer");
    expect(result.templateMapped).toBe(true);
    expect(result.snapshotMapped).toBe(true);
    expect(result.nextCommands).toContain("pnpm smoke:polymarket-readonly");
  });
});
