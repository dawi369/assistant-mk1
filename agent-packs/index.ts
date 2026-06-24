import { babyPolymancerPack } from "./baby-polymancer";
import { babySwordfishPack } from "./baby-swordfish";
import { repoAnalystPack } from "./repo-analyst";

import type { LocalAgentPackManifest } from "./types";

export const localAgentPacks = [repoAnalystPack, babyPolymancerPack, babySwordfishPack] as const;

export type {
  AgentPackCapabilityLevel,
  AgentPackDeclaredTool,
  AgentPackRisk,
  AgentPackUiHints,
  AgentPackWorkflow,
  LocalAgentPackManifest,
} from "./types";

export const validateLocalAgentPack = (pack: LocalAgentPackManifest) => {
  const requiredStrings = [
    ["id", pack.id],
    ["templateId", pack.templateId],
    ["name", pack.name],
    ["description", pack.description],
    ["version", pack.version],
    ["folderPath", pack.folderPath],
    ["codePath", pack.codePath],
    ["promptPath", pack.promptPath],
    ["prompt", pack.prompt],
  ] as const;

  for (const [field, value] of requiredStrings) {
    if (!value.trim()) throw new Error(`Agent pack ${field} is required.`);
  }

  if (pack.kind !== "agent_pack") {
    throw new Error(`Agent pack ${pack.id} kind must be "agent_pack".`);
  }
  if (!pack.templateId.startsWith("pack-")) {
    throw new Error(`Agent pack ${pack.id} templateId must start with "pack-".`);
  }
  if (!["template", "single_agent_app"].includes(pack.capabilityLevel)) {
    throw new Error(`Agent pack ${pack.id} capabilityLevel is invalid.`);
  }
  if (pack.format !== "xml") {
    throw new Error(`Agent pack ${pack.id} must use XML prompt format.`);
  }
  if (!["default", "analyst", "operator"].includes(pack.profile)) {
    throw new Error(`Agent pack ${pack.id} profile is invalid.`);
  }
  if (!pack.prompt.includes("<identity>")) {
    throw new Error(`Agent pack ${pack.id} prompt must include an identity section.`);
  }
  if (pack.risk.requiresSecrets) {
    throw new Error(`Agent pack ${pack.id} cannot require secrets in pack contract v1.`);
  }
  if (!pack.tools.length) {
    throw new Error(`Agent pack ${pack.id} must declare at least one tool.`);
  }
  const toolIds = new Set<string>();
  for (const tool of pack.tools) {
    if (!tool.id.trim()) throw new Error(`Agent pack ${pack.id} tool id is required.`);
    if (toolIds.has(tool.id))
      throw new Error(`Agent pack ${pack.id} tool ${tool.id} is duplicate.`);
    toolIds.add(tool.id);
    if (!tool.executionModes.length) {
      throw new Error(`Agent pack ${pack.id} tool ${tool.id} must declare execution modes.`);
    }
    if (tool.executionModes.includes("execute") && !pack.risk.externalMutation) {
      throw new Error(
        `Agent pack ${pack.id} tool ${tool.id} cannot declare execute without externalMutation risk.`,
      );
    }
    if (tool.executionModes.includes("execute") && pack.risk.productionGate === "none") {
      throw new Error(
        `Agent pack ${pack.id} tool ${tool.id} cannot declare execute without a production gate.`,
      );
    }
    if (!tool.purpose.trim()) {
      throw new Error(`Agent pack ${pack.id} tool ${tool.id} purpose is required.`);
    }
  }
  for (const workflow of pack.workflows) {
    if (!workflow.type.trim()) throw new Error(`Agent pack ${pack.id} workflow type is required.`);
    if (!["cloudflare", "langgraph"].includes(workflow.engine)) {
      throw new Error(`Agent pack ${pack.id} workflow ${workflow.type} engine is invalid.`);
    }
    if (workflow.status !== "declared") {
      throw new Error(`Agent pack ${pack.id} workflow ${workflow.type} must be declared.`);
    }
    if (!workflow.description.trim()) {
      throw new Error(`Agent pack ${pack.id} workflow ${workflow.type} description is required.`);
    }
  }
  if (!["chat", "workbench", "admin"].includes(pack.ui.primarySurface)) {
    throw new Error(`Agent pack ${pack.id} ui.primarySurface is invalid.`);
  }
  if (!["code", "ui_future"].includes(pack.ui.configurationMode)) {
    throw new Error(`Agent pack ${pack.id} ui.configurationMode is invalid.`);
  }

  return pack;
};

export const validateLocalAgentPacks = (
  packs: readonly LocalAgentPackManifest[],
): LocalAgentPackManifest[] => {
  const packIds = new Set<string>();
  const templateIds = new Set<string>();
  return packs.map((pack) => {
    if (packIds.has(pack.id)) throw new Error(`Agent pack id ${pack.id} is duplicate.`);
    if (templateIds.has(pack.templateId)) {
      throw new Error(`Agent pack templateId ${pack.templateId} is duplicate.`);
    }
    packIds.add(pack.id);
    templateIds.add(pack.templateId);
    return validateLocalAgentPack(pack);
  });
};

export const loadLocalAgentPacks = (): LocalAgentPackManifest[] =>
  validateLocalAgentPacks(localAgentPacks);
