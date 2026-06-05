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
