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

export type ToolSummary = {
  name: string;
  description: string;
  kind: string;
  family: string;
  status: string;
  supportedExecutionModes: string[];
  adminVisible: boolean;
  modelVisible: boolean;
  reason: string;
  requiresSecrets: boolean;
  mutationRisk: "read_only" | "mutation_capable";
  runner?: {
    transport?: "cloudflare_inline" | "fly";
    adapterVersion?: string;
    source?: "admin" | "approval" | "model" | "demo-compat";
  };
  permissionStatus?: "enabled" | "disabled" | "pending_review";
  policyReference?: string;
  allowedExecutionModes?: string[];
  approvalRequired?: boolean;
  killSwitchReason?: string;
  policyEditable?: boolean;
  policyConstraints?: {
    limits?: {
      perUserPerHour?: number;
      perWorkspacePerHour?: number;
    };
    cooldownSeconds?: number;
    allowlist?: string[];
    denylist?: string[];
    maxRuntimeMs?: number;
    maxArtifactBytes?: number;
  };
  adminPolicy?: {
    decision?: "allow" | "block";
    code?: string;
    reason?: string;
    executionMode?: string;
    policyReference?: string;
    constraints?: ToolSummary["policyConstraints"];
  };
  modelExposurePolicy?: {
    decision?: "allow" | "block";
    code?: string;
    reason?: string;
    executionMode?: string;
    policyReference?: string;
    constraints?: ToolSummary["policyConstraints"];
  };
  latestApprovalRequest?: {
    id?: Id;
    status?: string;
    reason?: string;
    createdAt?: string;
    updatedAt?: string;
    data?: Record<string, unknown>;
  };
};

export type ToolCallSummary = {
  id: Id;
  scope?: TenantScope;
  agentId?: Id;
  workflowIntentId?: Id;
  runId?: Id;
  toolId?: string;
  status?: string;
  inputSummary?: string;
  outputSummary?: string;
  artifactRefs?: unknown[];
  data?: Record<string, unknown>;
  startedAt?: string;
  finishedAt?: string;
  createdAt?: string;
};

export type ArtifactSummary = {
  id: Id;
  scope?: TenantScope;
  kind?: string;
  uri?: string;
  title?: string;
  mimeType?: string;
  sizeBytes?: number;
  data?: Record<string, unknown>;
  createdAt?: string;
};

export type ToolApprovalRequestSummary = {
  id?: Id;
  scope?: TenantScope;
  agentId?: Id;
  workflowIntentId?: Id;
  runId?: Id;
  toolId?: string;
  status?: string;
  reason?: string;
  input?: {
    url?: string;
  };
  source?: string;
  executionMode?: string;
  policyDecisionId?: Id;
  decision?: {
    decidedAt?: string;
    decidedByUserId?: Id;
    denyReason?: string;
    policyDecisionId?: Id;
    error?: {
      code?: string;
      message?: string;
    };
  };
  currentPolicy?: {
    decision?: "allow" | "block";
    code?: string;
    reason?: string;
    executionMode?: string;
    policyReference?: string;
  };
  createdAt?: string;
  updatedAt?: string;
};

export type CloudflareToolsResponse = {
  ok?: boolean;
  tools?: ToolSummary[];
  latestToolCalls?: ToolCallSummary[];
  latestArtifacts?: ArtifactSummary[];
  error?: string;
};

export type CloudflareToolApprovalsResponse = {
  ok?: boolean;
  status?: "requested" | "decided" | "all" | string;
  approvals?: ToolApprovalRequestSummary[];
  error?: string;
  details?: {
    code?: string;
    message?: string;
    retryable?: boolean;
    redacted?: boolean;
  };
};

export type CloudflareToolRunResponse = {
  ok?: boolean;
  run?: {
    id?: Id;
    workflowIntentId?: Id;
    status?: string;
    execution?: Partial<ExecutionPolicy>;
    policyDecisionId?: Id;
  };
  approvalRequest?: ToolApprovalRequestSummary;
  toolCall?: ToolCallSummary | null;
  artifact?: ArtifactSummary | null;
  error?:
    | string
    | {
        code?: string;
        message?: string;
        retryable?: boolean;
        redacted?: boolean;
      };
  details?: {
    code?: string;
    message?: string;
    retryable?: boolean;
    redacted?: boolean;
  };
  policyDecisionId?: Id;
};

export type CloudflareToolPolicyUpdateResponse = {
  ok?: boolean;
  toolName?: string;
  status?: "enabled" | "disabled";
  requiresApproval?: boolean;
  modelVisible?: boolean;
  policyConstraints?: ToolSummary["policyConstraints"];
  permissionId?: Id;
  policyDecisionId?: Id;
  tool?: ToolSummary;
  error?: string;
  details?: {
    code?: string;
    message?: string;
    retryable?: boolean;
    redacted?: boolean;
  };
};

export type CloudflareToolApprovalActionResponse = CloudflareToolRunResponse;

export type RuntimeTraceStatus = "running" | "completed" | "failed" | "blocked";

export type RuntimeTraceLayer =
  | "browser"
  | "vercel"
  | "cloudflare"
  | "durable_object"
  | "d1"
  | "provider"
  | "executor"
  | "tool";

export type RuntimeTrace = {
  traceId: Id;
  scope?: TenantScope;
  agentId?: Id;
  kind:
    | "chat.thread.create"
    | "chat.run.stream"
    | "chat.agent.stream"
    | "tool.url.inspect"
    | "diagnostic.demo.inspect";
  status: RuntimeTraceStatus;
  rootName: string;
  summary?: string;
  bottleneckSpanId?: Id;
  bottleneckConfidence?: "exact" | "fallback";
  bottleneckReason?: string;
  data?: Record<string, unknown>;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type RuntimeSpan = {
  spanId: Id;
  traceId: Id;
  parentSpanId?: Id;
  scope?: TenantScope;
  agentId?: Id;
  name: string;
  layer: RuntimeTraceLayer;
  status: RuntimeTraceStatus;
  spanType?: "operation" | "phase" | "event";
  isAggregate?: boolean;
  bottleneckCandidate?: boolean;
  offsetMs?: number;
  data?: Record<string, unknown>;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type CloudflareRuntimeTracesResponse = {
  ok?: boolean;
  latestTrace?: RuntimeTrace | null;
  recentTraces?: RuntimeTrace[];
  traceWaterfall?: RuntimeSpan[];
  error?: string;
};

export type CloudflareRuntimeTraceResponse = {
  ok?: boolean;
  trace?: RuntimeTrace | null;
  spans?: RuntimeSpan[];
  error?: string;
};

export type AgentRuntimeConfig = {
  provider: "openrouter";
  model: string;
  temperature: number;
  maxTokens: number;
  source: "agent" | "system-default";
};

export type AgentBehaviorConfig = {
  profile: "default" | "analyst" | "operator";
  source: "server-preset" | "template-snapshot";
  version: string;
  instructionId: string;
  format?: "xml";
  templateId?: string;
  preview?: string;
};

export type AgentBehaviorTemplate = {
  id: "assistant-general" | "assistant-analyst" | "assistant-operator" | "assistant-integrator";
  name: string;
  description: string;
  profile: "default" | "analyst" | "operator";
  version: string;
  format: "xml";
  prompt: string;
};

export type ChatRuntimeSummary = {
  state:
    | "no_session"
    | "no_thread"
    | "thread_ready"
    | "blocked"
    | "running"
    | "failed"
    | "completed";
  latestSession: {
    sessionId?: Id;
    agentId?: Id;
    status?: string;
    activeThreadId?: Id;
    metadata?: Record<string, unknown>;
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
    agentId?: Id;
    upstreamRunId?: Id;
    status?: string;
    metadata?: Record<string, unknown>;
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
    limits?: Record<string, unknown>;
    createdAt?: string;
  } | null;
  timings: {
    firstTokenMs?: number;
    totalMs?: number;
    preStreamMs?: number;
    providerMs?: number;
    stageMarks: Record<string, number>;
  } | null;
  events: ControlPlaneEvent[];
  failure: {
    source: "chat-run" | "chat-policy";
    message: string;
    status?: string;
    targetId?: Id;
    createdAt?: string;
    errorCode?: string;
    retryable?: boolean;
  } | null;
};

export type ChatRuntimeSummaryResponse = {
  ok?: boolean;
  generatedAt?: string;
  chatRuntime?: ChatRuntimeSummary;
  error?: string;
};

export type ChatThreadSummary = {
  threadId: Id;
  sessionId: Id;
  agentId: Id;
  agent?: AgentSummary | null;
  status: string;
  title: string;
  createdAt?: string;
  updatedAt?: string;
  lastSeenAt?: string;
  isActive: boolean;
  latestRunStatus?: string;
  messageCount?: number;
};

export type ChatThreadStatus = "active" | "archived" | "deleted";

export type ChatThreadsResponse = {
  ok?: boolean;
  threads?: ChatThreadSummary[];
  error?: string;
};

export type ChatThreadResponse = {
  ok?: boolean;
  thread?: ChatThreadSummary | null;
  error?: string;
};

export type ChatSessionResponse = {
  ok?: boolean;
  revision?: number;
  isStale?: boolean;
  partial?: boolean;
  threadsRefreshRecommended?: boolean;
  workspace?: {
    id: Id;
    name: string;
    status: string;
    isDefault: boolean;
  } | null;
  activeAgent?: AgentSummary | null;
  activeThread?: ChatThreadSummary | null;
  threads?: ChatThreadSummary[];
  connection?: {
    agentHost?: string;
    agentName?: string;
    instanceName?: string;
    token?: string;
    threadId?: Id;
    sessionId?: Id;
    workspaceId?: Id;
    agentId?: Id;
    expiresAt?: string;
  };
  pending?: { type: "create" } | { type: "activate"; threadId: Id };
  transition?: {
    type:
      | "initial"
      | "create"
      | "activate"
      | "rename"
      | "archive"
      | "restore"
      | "delete"
      | "token_refresh";
    startedAt?: string;
  };
  expiresAt?: string;
  error?: string;
};

export type WorkbenchSessionEvent = {
  id: Id;
  type:
    | "session.snapshot"
    | "session.thread.created"
    | "session.thread.activated"
    | "session.thread.updated"
    | "session.threads.refreshed"
    | "chat.run.started"
    | "chat.run.completed"
    | "chat.run.failed"
    | "approval.updated"
    | "tool.run.updated"
    | "trace.updated"
    | "admin.summary.invalidated";
  revision?: number;
  createdAt: string;
  data: Record<string, unknown>;
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
    demo: {
      latestRun: CloudflareOwnedDemoRunSnapshot | null;
    };
    tools: ToolSummary[];
    latestToolCalls: ToolCallSummary[];
    latestArtifacts: ArtifactSummary[];
    latestTrace: RuntimeTrace | null;
    recentTraces: RuntimeTrace[];
    traceWaterfall: RuntimeSpan[];
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

export type AgentSummary = {
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
};

export type CloudflareAgentsResponse = {
  ok?: boolean;
  activeAgentId?: Id;
  agents?: AgentSummary[];
  error?: string;
};

export type CloudflareAgentBehaviorTemplatesResponse = {
  ok?: boolean;
  templates?: AgentBehaviorTemplate[];
  error?: string;
};

export type CloudflareAgentMutationResponse = {
  ok?: boolean;
  activeAgentId?: Id;
  agent?: AgentSummary | null;
  error?: string;
};
