import type { AgentProfile } from "@/cloudflare/control-plane/src/agent-records";
import type { ExecutionMode } from "@/cloudflare/control-plane/src/types";

export type AgentPackCapabilityLevel = "template" | "single_agent_app";

export type AgentPackDeclaredTool = {
  id: string;
  required: boolean;
  executionModes: readonly ExecutionMode[];
  modelVisibleDefault: boolean;
  purpose: string;
};

export type AgentPackWorkflow = {
  type: string;
  engine: "cloudflare" | "langgraph";
  status: "declared";
  description: string;
};

export type AgentPackUiHints = {
  primarySurface: "chat" | "workbench" | "admin";
  inspectorSections: readonly string[];
  configurationMode: "code" | "ui_future";
};

export type AgentPackRisk = {
  financialData: boolean;
  externalMutation: boolean;
  requiresSecrets: boolean;
  productionGate: "none" | "mutation_gate" | string;
};

export type LocalAgentPackManifest = {
  kind: "agent_pack";
  id: string;
  templateId: string;
  name: string;
  description: string;
  profile: AgentProfile;
  version: string;
  capabilityLevel: AgentPackCapabilityLevel;
  format: "xml";
  folderPath: string;
  codePath: string;
  promptPath: string;
  tools: readonly AgentPackDeclaredTool[];
  workflows: readonly AgentPackWorkflow[];
  ui: AgentPackUiHints;
  risk: AgentPackRisk;
  context: readonly string[];
  smokeScenarios: readonly {
    id: string;
    prompt: string;
  }[];
  prompt: string;
};
