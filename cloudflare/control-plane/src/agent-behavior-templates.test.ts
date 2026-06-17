import { describe, expect, it } from "vitest";

import { agentBehaviorTemplates, createAgentBehaviorSnapshot } from "./agent-behavior-templates";

describe("agent behavior authoring metadata", () => {
  it("marks built-in templates as non-editable XML snapshots", () => {
    expect(agentBehaviorTemplates).not.toHaveLength(0);
    for (const template of agentBehaviorTemplates) {
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
});
