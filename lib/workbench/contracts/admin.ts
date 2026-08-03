import type { Id } from "@/lib/workbench/core-contracts";
import type { AdminSummaryProjection } from "../admin-summary-projection";
import type { AgentBehaviorConfig, AgentRuntimeConfig, ChatRuntimeSummary } from "./agents-chat";
import type {
  ArtifactSummary,
  ControlPlaneEvent,
  DynamicCapabilityContext,
  DynamicCapabilityDecision,
  ExecutionRunSnapshot,
  RuntimeSpan,
  RuntimeTrace,
  ToolCallSummary,
  ToolSummary,
} from "./execution";
import type { WorkspaceSummary } from "./tenancy";

export type CloudflareAdminSummaryResponse = {
  ok?: boolean;
  summary?: {
    generatedAt: string;
    diagnostics?: {
      projection: AdminSummaryProjection;
      totalDurationMs: number;
      sections: Record<string, { durationMs: number; count?: number }>;
    };
    identity: {
      userId: Id;
      workspaceId: Id;
      agentId: Id;
      authMode: string;
      workspaceSource: string;
    };
    account: {
      id: Id;
      source: string;
    } | null;
    user: {
      id: Id;
      email: string | null;
      displayName: string | null;
      status: string;
    } | null;
    workspace: {
      id: Id;
      name: string;
      status: string;
      isDefault: boolean;
      isActive: boolean;
    } | null;
    workspaces: WorkspaceSummary[];
    membership: {
      source: "cloudflare-d1";
      role: string;
      status: string;
      roles: string[];
      permissions: string[];
    } | null;
    externalMembership: {
      source: "workos-headers";
      role: string | null;
      status: string | null;
      roles: string[];
      permissions: string[];
    } | null;
    defaultAgent: {
      id: Id;
      name: string;
      description: string | null;
      status: string;
      profile: "default" | "analyst" | "operator";
      runtime: AgentRuntimeConfig;
      behavior: AgentBehaviorConfig;
      isDefault: boolean;
      isActive: boolean;
      createdAt?: string;
      updatedAt?: string;
    } | null;
    activeAgent: {
      id: Id;
      name: string;
      description: string | null;
      status: string;
      profile: "default" | "analyst" | "operator";
      runtime: AgentRuntimeConfig;
      behavior: AgentBehaviorConfig;
      isDefault: boolean;
      isActive: boolean;
      createdAt?: string;
      updatedAt?: string;
    } | null;
    agents: Array<{
      id: Id;
      name: string;
      description: string | null;
      status: string;
      profile: "default" | "analyst" | "operator";
      runtime: AgentRuntimeConfig;
      behavior: AgentBehaviorConfig;
      isDefault: boolean;
      isActive: boolean;
      createdAt?: string;
      updatedAt?: string;
    }>;
    chat: Omit<ChatRuntimeSummary, "state" | "events" | "failure">;
    chatRuntime: ChatRuntimeSummary;
    execution: {
      latestRun: ExecutionRunSnapshot | null;
    };
    capabilityContext: DynamicCapabilityContext;
    capabilityDecisions: DynamicCapabilityDecision[];
    tools: ToolSummary[];
    latestToolCalls: ToolCallSummary[];
    latestArtifacts: ArtifactSummary[];
    latestTrace: RuntimeTrace | null;
    recentTraces: RuntimeTrace[];
    traceWaterfall: RuntimeSpan[];
    events: ControlPlaneEvent[];
    lastError: {
      source: "chat" | "execution" | "event";
      message: string;
      status?: string;
      targetId?: Id;
      createdAt?: string;
    } | null;
  };
  error?: string;
};
