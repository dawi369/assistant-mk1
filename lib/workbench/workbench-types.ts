import type {
  ExecutionPolicy,
  Id,
  RunStatus,
  TenantScope,
  WorkflowStage,
} from "@/lib/agent-framework/contracts";

export type CloudflareOwnedDemoRunSnapshot = {
  scope: TenantScope;
  intent: {
    id?: Id;
    type?: string;
    stage?: WorkflowStage | string;
    execution?: Partial<ExecutionPolicy>;
    payload?: unknown;
  } | null;
  run: {
    id?: Id;
    status?: RunStatus | string;
    workflowIntentId?: Id;
    execution?: Partial<ExecutionPolicy>;
    stage?: WorkflowStage | string;
    updatedAt?: string;
    data?: Record<string, unknown>;
  } | null;
  toolCalls: Array<{
    id: Id;
    toolId?: string;
    status?: string;
    inputSummary?: string;
    outputSummary?: string;
  }>;
  artifacts: Array<{
    id: Id;
    title?: string;
    uri?: string;
    mimeType?: string;
  }>;
  decisions: Array<{
    id: Id;
    title?: string;
    summary?: string;
    thesis?: string;
  }>;
  auditEvents: Array<{
    id: Id;
    action?: string;
    summary?: string;
    createdAt?: string;
  }>;
};

export type CloudflareOwnedDemoRunResponse = {
  ok?: boolean;
  snapshot?: CloudflareOwnedDemoRunSnapshot | null;
  error?: string;
};

export type ControlPlaneEvent = {
  id: Id;
  type?: string;
  summary?: string;
  targetType?: string;
  targetId?: string;
  data?: Record<string, unknown>;
  createdAt?: string;
};

export type ControlPlaneEventsResponse = {
  ok?: boolean;
  events?: ControlPlaneEvent[];
  error?: string;
};

export type WorkspaceContextResponse = {
  ok?: boolean;
  context?: {
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
    } | null;
    membership: {
      role: string;
      status: string;
      roles: string[];
      permissions: string[];
    } | null;
    agent: {
      id: Id;
      name: string;
      status: string;
      isDefault: boolean;
    } | null;
  };
  error?: string;
};

export type CloudflareAdminSummaryResponse = {
  ok?: boolean;
  summary?: {
    generatedAt: string;
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
      isDefault: boolean;
      createdAt?: string;
      updatedAt?: string;
    } | null;
    agents: Array<{
      id: Id;
      name: string;
      description: string | null;
      status: string;
      isDefault: boolean;
      createdAt?: string;
      updatedAt?: string;
    }>;
    chat: {
      latestSession: {
        sessionId?: Id;
        agentId?: Id;
        status?: string;
        activeThreadId?: Id;
        createdAt?: string;
        updatedAt?: string;
        lastSeenAt?: string;
      } | null;
      latestThread: {
        threadId?: Id;
        sessionId?: Id;
        agentId?: Id;
        status?: string;
        createdAt?: string;
        updatedAt?: string;
        lastSeenAt?: string;
      } | null;
      latestRun: {
        id?: Id;
        threadId?: Id;
        upstreamRunId?: Id;
        status?: string;
        error?: string;
        startedAt?: string;
        completedAt?: string;
        failedAt?: string;
        updatedAt?: string;
      } | null;
      latestIntent: {
        id?: Id;
        executionMode?: string;
        status?: string;
        updatedAt?: string;
      } | null;
      latestPolicyDecision: {
        id?: Id;
        decision?: string;
        reason?: string;
        executionMode?: string;
        createdAt?: string;
      } | null;
    };
    demo: {
      latestRun: CloudflareOwnedDemoRunSnapshot | null;
    };
    events: ControlPlaneEvent[];
    lastError: {
      source: "chat" | "demo" | "event";
      message: string;
      status?: string;
      targetId?: Id;
      createdAt?: string;
    } | null;
  };
  error?: string;
};

export type WorkspaceSummary = {
  id: Id;
  name: string;
  status: string;
  isDefault: boolean;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type CloudflareWorkspacesResponse = {
  ok?: boolean;
  account?: {
    id: Id;
    source: string;
  };
  activeWorkspaceId?: Id;
  workspaces?: WorkspaceSummary[];
  error?: string;
};

export type CloudflareWorkspaceMutationResponse = {
  ok?: boolean;
  activeWorkspaceId?: Id;
  workspace?: WorkspaceSummary | null;
  defaultAgent?: {
    id: Id;
    name: string;
    status: string;
    isDefault: boolean;
  } | null;
  agent?: {
    id: Id;
    name: string;
    status: string;
    isDefault: boolean;
  } | null;
  error?: string;
};
