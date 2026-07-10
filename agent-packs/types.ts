export const agentPackProfiles = ["default", "analyst", "operator"] as const;
export type AgentPackProfile = (typeof agentPackProfiles)[number];

export const agentPackExecutionModes = ["ask", "dry_run", "execute"] as const;
export type AgentPackExecutionMode = (typeof agentPackExecutionModes)[number];

export const agentPackToolInvocations = ["user", "agent", "workflow"] as const;
export type AgentPackToolInvocation = (typeof agentPackToolInvocations)[number];

export type AgentPackCapabilityLevel = "template" | "single_agent_app";

export type AgentPackDeclaredTool = {
  id: string;
  invocation: AgentPackToolInvocation;
  required: boolean;
  executionModes: readonly AgentPackExecutionMode[];
  modelVisibleDefault: boolean;
  purpose: string;
};

export type AgentPackWorkflow = {
  type: string;
  engine: "cloudflare" | "langgraph";
  status: "declared";
  userInvocable: boolean;
  description: string;
};

export type AgentPackStarter = {
  id: string;
  title: string;
  description: string;
  action: { kind: "message"; prompt: string } | { kind: "workflow"; workflowType: string };
};

export type AgentPackUiHints = {
  primarySurface: "chat" | "workbench" | "admin";
  inspectorSections: readonly string[];
  configurationMode: "code" | "ui_future";
  welcome: {
    title: string;
    description: string;
    starters: readonly AgentPackStarter[];
  };
};

export type AgentPackRisk = {
  financialData: boolean;
  externalMutation: boolean;
  requiresSecrets: boolean;
  productionGate: "none" | "mutation_gate" | string;
};

export type LocalAgentPackManifest = {
  apiVersion: 1;
  kind: "agent_pack";
  id: string;
  templateId: `pack-${string}`;
  name: string;
  description: string;
  profile: AgentPackProfile;
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

export type AgentPackDefinition = Omit<
  LocalAgentPackManifest,
  "apiVersion" | "kind" | "templateId"
>;

export const defineAgentPack = <const T extends AgentPackDefinition>(
  definition: T,
): T & Pick<LocalAgentPackManifest, "apiVersion" | "kind" | "templateId"> => ({
  apiVersion: 1,
  kind: "agent_pack",
  templateId: `pack-${definition.id}`,
  ...definition,
});
