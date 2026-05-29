export type Id = string;

export type TenantScope = {
  userId: Id;
  workspaceId: Id;
};

export type WorkflowStage = "observe" | "analyze" | "propose" | "execute" | "review";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export type TriggerSource =
  | "user_message"
  | "schedule"
  | "webhook"
  | "tool_event"
  | "system_event"
  | "manual";

export type RuntimeTarget = "cloudflare_agent" | "langgraph" | "tool_runner";

export type ArtifactRef = {
  id: Id;
  kind: "file" | "log" | "report" | "screenshot" | "trace" | "other";
  uri: string;
  title?: string;
  mimeType?: string;
};

export type ProvenanceRef = {
  id: Id;
  kind:
    | "user_note"
    | "tool_result"
    | "workflow_output"
    | "external_trigger"
    | "manual_override"
    | "artifact"
    | "run"
    | "other";
  title?: string;
  uri?: string;
  capturedAt?: string;
};

export type DecisionRecord = {
  id: Id;
  scope: TenantScope;
  title: string;
  summary: string;
  decisionType: "belief" | "strategy" | "plan" | "action" | "risk" | "preference" | "other";
  thesis: string;
  evidence: string[];
  counterEvidence: string[];
  alternatives: string[];
  confidence: number;
  provenance: ProvenanceRef[];
  relatedRunIds: Id[];
  relatedToolCallIds: Id[];
  artifacts: ArtifactRef[];
  status: "active" | "superseded" | "rejected" | "stale" | "archived";
  createdAt: string;
  updatedAt: string;
  revisitAfter?: string;
  domain?: string;
  domainData?: Record<string, unknown>;
};

export type WorkflowIntent<Payload = Record<string, unknown>> = {
  id: Id;
  scope: TenantScope;
  stage: WorkflowStage;
  target: RuntimeTarget;
  workflowType: string;
  trigger: TriggerSource;
  risk: RiskLevel;
  requiresApproval: boolean;
  dryRun: boolean;
  payload: Payload;
  relatedDecisionIds: Id[];
  createdAt: string;
};

export type ToolDefinition<Input = Record<string, unknown>, Output = Record<string, unknown>> = {
  name: string;
  description: string;
  kind: "native" | "api" | "cli" | "oss_package" | "submodule";
  inputSchemaName: string;
  outputSchemaName: string;
  requiredSecrets: string[];
  permissions: string[];
  risk: RiskLevel;
  supportsDryRun: boolean;
  timeoutMs: number;
  logging: {
    redactInputs: string[];
    redactOutputs: string[];
    artifactPolicy: "none" | "summary" | "full";
  };
  isAvailable(scope: TenantScope): boolean | Promise<boolean>;
  execute(input: Input, context: ToolExecutionContext): Promise<ToolResult<Output>>;
};

export type ToolExecutionContext = {
  scope: TenantScope;
  intentId?: Id;
  runId?: Id;
  dryRun: boolean;
  signal?: AbortSignal;
};

export type ToolResult<Output = Record<string, unknown>> = {
  ok: boolean;
  output?: Output;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
  artifacts: ArtifactRef[];
  auditSummary: string;
};
