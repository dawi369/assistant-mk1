import { parseDataJson } from "./http";
import { createId, toJson, type AgentRow, type Env } from "./types";

export const agentProfiles = ["default", "analyst", "operator"] as const;
export type AgentProfile = (typeof agentProfiles)[number];

const isAgentProfile = (value: string): value is AgentProfile =>
  agentProfiles.includes(value as AgentProfile);

export const normalizeAgentProfile = (value: unknown): AgentProfile | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return isAgentProfile(normalized) ? normalized : null;
};

export const getAgentProfile = (row: AgentRow): AgentProfile => {
  const data = parseDataJson(row.data_json);
  return normalizeAgentProfile(data.profile) ?? "default";
};

export const toAgentSummary = (row: AgentRow, activeAgentId: string) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  status: row.status,
  profile: getAgentProfile(row),
  isDefault: row.is_default === 1,
  isActive: row.id === activeAgentId,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const toAgentRuntimeMetadata = (row: AgentRow | null, fallbackAgentId: string) =>
  row
    ? {
        id: row.id,
        name: row.name,
        profile: getAgentProfile(row),
        isDefault: row.is_default === 1,
      }
    : {
        id: fallbackAgentId,
        profile: "default" satisfies AgentProfile,
      };

export const insertAgent = async (
  env: Env,
  input: {
    workspaceId: string;
    userId: string;
    name: string;
    description: string | null;
    profile: AgentProfile;
  },
) => {
  const timestamp = new Date().toISOString();
  const agentId = createId("agent");
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
      }),
      timestamp,
      timestamp,
    )
    .run();
  return agentId;
};
