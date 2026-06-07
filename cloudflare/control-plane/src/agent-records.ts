import { parseDataJson } from "./http";
import { createId, toJson, type AgentRow, type Env } from "./types";

export const agentProfiles = ["default", "analyst", "operator"] as const;
export type AgentProfile = (typeof agentProfiles)[number];
export const allowedOpenRouterModels = [
  "deepseek/deepseek-v4-flash",
  "openai/gpt-4.1-mini",
] as const;
export type AllowedOpenRouterModel = (typeof allowedOpenRouterModels)[number];

const defaultModel = "openai/gpt-4.1-mini";
const defaultTemperature = 0.4;
const defaultMaxTokens = 1200;

export type AgentRuntimeConfig = {
  provider: "openrouter";
  model: string;
  temperature: number;
  maxTokens: number;
  source: "agent" | "system-default";
};

export type AgentBehaviorConfig = {
  profile: AgentProfile;
  source: "server-preset";
  version: "2026-06-07";
  instructionId: `agent-behavior-${AgentProfile}`;
};

const behaviorVersion = "2026-06-07" as const;

const behaviorInstructions = {
  default:
    "You are the default assistant for this workspace. Be clear, practical, and concise. Ask for missing context when it materially affects the answer. Keep responses useful across many project types and avoid assuming a domain that was not provided.",
  analyst:
    "You are operating in analyst mode for this workspace. Emphasize structure, tradeoffs, assumptions, and verification. Prefer careful analysis over speed, but keep conclusions actionable and avoid unnecessary detail.",
  operator:
    "You are operating in operator mode for this workspace. Emphasize direct next actions, execution readiness, blockers, and concise status. Prefer checkable steps and concrete outcomes over broad exploration.",
} satisfies Record<AgentProfile, string>;

const isAgentProfile = (value: string): value is AgentProfile =>
  agentProfiles.includes(value as AgentProfile);

export const isAllowedOpenRouterModel = (value: string): value is AllowedOpenRouterModel =>
  allowedOpenRouterModels.includes(value as AllowedOpenRouterModel);

export const normalizeOpenRouterModel = (value: unknown): AllowedOpenRouterModel | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return isAllowedOpenRouterModel(normalized) ? normalized : null;
};

export const normalizeAgentProfile = (value: unknown): AgentProfile | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return isAgentProfile(normalized) ? normalized : null;
};

export const getAgentProfile = (row: AgentRow): AgentProfile => {
  const data = parseDataJson(row.data_json);
  return normalizeAgentProfile(data.profile) ?? "default";
};

const systemDefaultRuntimeConfig = (env: Env): AgentRuntimeConfig => ({
  provider: "openrouter",
  model: normalizeOpenRouterModel(env.OPENROUTER_MODEL) ?? defaultModel,
  temperature: defaultTemperature,
  maxTokens: defaultMaxTokens,
  source: "system-default",
});

export const resolveAgentRuntimeConfig = (env: Env, row: AgentRow | null): AgentRuntimeConfig => {
  const fallback = systemDefaultRuntimeConfig(env);
  if (!row) return fallback;

  const data = parseDataJson(row.data_json);
  const runtime = data.runtime;
  if (!runtime || typeof runtime !== "object" || Array.isArray(runtime)) return fallback;

  const record = runtime as Record<string, unknown>;
  const provider = record.provider === "openrouter" ? "openrouter" : null;
  const model = normalizeOpenRouterModel(record.model);
  if (!provider || !model) return fallback;

  return {
    provider,
    model,
    temperature: defaultTemperature,
    maxTokens: defaultMaxTokens,
    source: "agent",
  };
};

export const resolveAgentBehaviorConfig = (row: AgentRow | null): AgentBehaviorConfig => {
  const profile = row ? getAgentProfile(row) : "default";
  return {
    profile,
    source: "server-preset",
    version: behaviorVersion,
    instructionId: `agent-behavior-${profile}`,
  };
};

export const resolveAgentBehaviorInstruction = (row: AgentRow | null) =>
  behaviorInstructions[resolveAgentBehaviorConfig(row).profile];

export const toAgentSummary = (env: Env, row: AgentRow, activeAgentId: string) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  status: row.status,
  profile: getAgentProfile(row),
  runtime: resolveAgentRuntimeConfig(env, row),
  behavior: resolveAgentBehaviorConfig(row),
  isDefault: row.is_default === 1,
  isActive: row.id === activeAgentId,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const toAgentRuntimeMetadata = (env: Env, row: AgentRow | null, fallbackAgentId: string) =>
  row
    ? {
        id: row.id,
        name: row.name,
        profile: getAgentProfile(row),
        runtime: resolveAgentRuntimeConfig(env, row),
        behavior: resolveAgentBehaviorConfig(row),
        isDefault: row.is_default === 1,
      }
    : {
        id: fallbackAgentId,
        profile: "default" satisfies AgentProfile,
        runtime: resolveAgentRuntimeConfig(env, null),
        behavior: resolveAgentBehaviorConfig(null),
      };

export const insertAgent = async (
  env: Env,
  input: {
    workspaceId: string;
    userId: string;
    name: string;
    description: string | null;
    profile: AgentProfile;
    model?: AllowedOpenRouterModel;
  },
) => {
  const timestamp = new Date().toISOString();
  const agentId = createId("agent");
  const runtime = input.model
    ? {
        provider: "openrouter",
        model: input.model,
        temperature: defaultTemperature,
        maxTokens: defaultMaxTokens,
      }
    : undefined;
  await env.DB.prepare(
    `INSERT INTO agents (
       id, workspace_id, name, description, status, is_default, created_by_user_id,
       data_json, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, 'active', 0, ?, ?, ?, ?)`,
  )
    .bind(
      agentId,
      input.workspaceId,
      input.name,
      input.description,
      input.userId,
      toJson({
        profile: input.profile,
        provisionedBy: "dev-monitor",
        ...(runtime ? { runtime } : {}),
      }),
      timestamp,
      timestamp,
    )
    .run();
  return agentId;
};
