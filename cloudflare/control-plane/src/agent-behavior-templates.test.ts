import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { agentBehaviorTemplates, createAgentBehaviorSnapshot } from "./agent-behavior-templates";

const promptFileByTemplateId = {
  "assistant-general": "assistant-general.xml",
  "assistant-analyst": "assistant-analyst.xml",
  "assistant-operator": "assistant-operator.xml",
  "assistant-integrator": "assistant-integrator.xml",
} as const;

const readPromptDoc = (fileName: string) =>
  readFileSync(new URL(`../../../docs/prompts/${fileName}`, import.meta.url), "utf8").trim();

const pokeSpecificFacts =
  /Poke|Interaction Company|Palo Alto|Spark Capital|General Catalyst|Bouncer|Recipes|Apple Messages|film\.poke\.com|poke\.com/i;

describe("agent behavior authoring metadata", () => {
  it("marks built-in templates as non-editable XML snapshots", () => {
    expect(agentBehaviorTemplates).not.toHaveLength(0);
    for (const template of agentBehaviorTemplates) {
      expect(template.version).toBe("2026-06-18");
      expect(template.authoring).toEqual({
        kind: "built_in_template",
        format: "xml",
        source: "cloudflare-control-plane",
        editable: false,
        snapshotOnCreate: true,
      });
    }
  });

  it("copies authoring metadata into behavior snapshots", () => {
    const snapshot = createAgentBehaviorSnapshot("operator", "assistant-operator");

    expect(snapshot).toMatchObject({
      templateId: "assistant-operator",
      version: "2026-06-18",
      source: "template-snapshot",
      format: "xml",
      authoring: {
        kind: "built_in_template",
        source: "cloudflare-control-plane",
        snapshotOnCreate: true,
      },
    });
    expect(snapshot.prompt).toContain("<identity>");
  });

  it("keeps runtime templates aligned with checked-in prompt docs", () => {
    for (const template of agentBehaviorTemplates) {
      expect(template.prompt.trim()).toBe(readPromptDoc(promptFileByTemplateId[template.id]));
    }
  });

  it("keeps built-in prompts generic and free of Poke-specific product facts", () => {
    for (const template of agentBehaviorTemplates) {
      expect(template.prompt).not.toMatch(pokeSpecificFacts);
    }
  });
});
