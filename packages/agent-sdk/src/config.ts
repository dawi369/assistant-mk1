export type AgentModuleEntry = {
  package: string;
  source?: string;
  enabled?: boolean;
  conformanceOnly?: boolean;
};

export type WorkbenchConfig = {
  runtimeApiVersion: 1;
  modules: readonly AgentModuleEntry[];
};

export const defineWorkbenchConfig = <const T extends WorkbenchConfig>(config: T): T => config;
