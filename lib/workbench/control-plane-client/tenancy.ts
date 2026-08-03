import type { Id } from "@/lib/workbench/core-contracts";
import type {
  AgentSummary,
  CloudflareAgentBehaviorTemplatesResponse,
  CloudflareAgentMutationResponse,
  CloudflareAgentsResponse,
  CloudflareWorkspaceMemberMutationResponse,
  CloudflareWorkspaceMembersResponse,
  CloudflareWorkspaceMutationResponse,
  CloudflareWorkspacesResponse,
} from "@/lib/workbench/workbench-types";
import { requestControlPlane } from "./transport";

export const getCloudflareWorkspaces = () =>
  requestControlPlane<CloudflareWorkspacesResponse>("/workspaces");

export const createCloudflareWorkspace = (input: { name: string }) =>
  requestControlPlane<CloudflareWorkspaceMutationResponse>("/workspaces", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const activateCloudflareWorkspace = (workspaceId: Id) =>
  requestControlPlane<CloudflareWorkspaceMutationResponse>(
    `/workspaces/${encodeURIComponent(workspaceId)}/activate`,
    { method: "POST" },
  );

export const getCloudflareWorkspaceMembers = (workspaceId: Id) =>
  requestControlPlane<CloudflareWorkspaceMembersResponse>(
    `/workspaces/${encodeURIComponent(workspaceId)}/members`,
  );

export const addCloudflareWorkspaceMember = (
  workspaceId: Id,
  input: { userId: Id; role: "owner" | "admin" | "member" },
) =>
  requestControlPlane<{
    ok?: boolean;
    userId?: Id;
    role?: string;
    status?: string;
    error?: string;
  }>(`/workspaces/${encodeURIComponent(workspaceId)}/members`, {
    method: "POST",
    body: JSON.stringify(input),
  });

export const updateCloudflareWorkspaceMember = (
  workspaceId: Id,
  userId: Id,
  input: { role: "owner" | "admin" | "member"; status: "active" | "disabled" },
) =>
  requestControlPlane<CloudflareWorkspaceMemberMutationResponse>(
    `/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userId)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );

export const getCloudflareAgents = () => requestControlPlane<CloudflareAgentsResponse>("/agents");

export const getCloudflareAgentBehaviorTemplates = () =>
  requestControlPlane<CloudflareAgentBehaviorTemplatesResponse>("/agent-behavior-templates");

export const createCloudflareAgent = (input: {
  name: string;
  description?: string;
  profile: AgentSummary["profile"];
  model?: string;
  behaviorTemplateId?: string;
  activate?: boolean;
}) =>
  requestControlPlane<CloudflareAgentMutationResponse>("/agents", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const activateCloudflareAgent = (agentId: Id) =>
  requestControlPlane<CloudflareAgentMutationResponse>(
    `/agents/${encodeURIComponent(agentId)}/activate`,
    { method: "POST" },
  );

export const instantiateCloudflareAgentPack = (packId: string) =>
  requestControlPlane<{
    ok: boolean;
    created: boolean;
    packId: string;
    packVersion: string;
    agent: AgentSummary;
  }>(`/agent-packs/${encodeURIComponent(packId)}/instantiate`, { method: "POST" });
