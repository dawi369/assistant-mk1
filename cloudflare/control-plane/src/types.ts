export type RunStatus =
  | "queued"
  | "running"
  | "waiting"
  | "interrupted"
  | "completed"
  | "failed"
  | "cancelled";

export type ExecutionMode = "ask" | "dry_run" | "execute";

export type D1PreparedStatement = {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
};

export type D1Result = {
  success?: boolean;
  meta?: {
    duration?: number;
    changes?: number;
    rows_read?: number;
    rows_written?: number;
  };
  results?: unknown[];
};

export type D1Database = {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
};

export type DurableObjectId = unknown;

export type DurableObjectStub = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

export type DurableObjectNamespace = {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
};

export type Env = {
  DB: D1Database;
  WorkbenchThreadChatAgent?: unknown;
  WorkbenchSessionAgent?: DurableObjectNamespace;
  CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN?: string;
  WORKBENCH_AGENT_CONNECTION_SECRET?: string;
  LANGGRAPH_UPSTREAM_URL?: string;
  LANGGRAPH_UPSTREAM_TOKEN?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  OPENROUTER_SITE_URL?: string;
  OPENROUTER_APP_NAME?: string;
  SENTRY_DSN?: string;
  SENTRY_ENVIRONMENT?: string;
  SENTRY_RELEASE?: string;
  SENTRY_TRACES_SAMPLE_RATE?: string;
  WORKBENCH_EXECUTOR_URL?: string;
  WORKBENCH_EXECUTOR_TOKEN?: string;
  ALLOWED_ORIGINS?: string;
};

export type WorkerExecutionContext = {
  waitUntil(promise: Promise<unknown>): void;
};

export type TenantScope = {
  userId: string;
  workspaceId: string;
};

export type AgentIdentity = {
  scope: TenantScope;
  agentId: string;
  accountId?: string;
  accountSource?: string;
};

export type UserRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  status: string;
  data_json: string;
  created_at: string;
  updated_at: string;
};

export type WorkspaceRow = {
  id: string;
  account_id: string;
  account_source: string;
  name: string;
  status: string;
  is_default: number;
  created_by_user_id: string;
  data_json: string;
  created_at: string;
  updated_at: string;
};

export type ActiveWorkspacePreferenceRow = {
  user_id: string;
  account_id: string;
  workspace_id: string;
  data_json: string;
  created_at: string;
  updated_at: string;
};

export type ActiveAgentPreferenceRow = {
  user_id: string;
  workspace_id: string;
  agent_id: string;
  data_json: string;
  created_at: string;
  updated_at: string;
};

export type MembershipRow = {
  id: string;
  user_id: string;
  workspace_id: string;
  role: string;
  status: string;
  roles_json: string;
  permissions_json: string;
  data_json: string;
  created_at: string;
  updated_at: string;
};

export type AgentRow = {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  status: string;
  is_default: number;
  created_by_user_id: string;
  data_json: string;
  created_at: string;
  updated_at: string;
};

export type ControlIntentRow = {
  id: string;
  user_id: string;
  workspace_id: string;
  agent_id: string;
  stage: string;
  type: string;
  execution_json: string;
  payload_json: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export type ControlRunRow = {
  id: string;
  user_id: string;
  workspace_id: string;
  agent_id: string;
  workflow_intent_id: string;
  status: RunStatus;
  execution_json: string;
  stage: string | null;
  engine: string | null;
  heartbeat_at: string | null;
  last_event_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  data_json: string;
  created_at: string;
  updated_at: string;
};

export type ControlToolCallRow = {
  id: string;
  user_id: string;
  workspace_id: string;
  agent_id: string;
  workflow_intent_id: string;
  run_id: string;
  tool_id: string;
  status: string;
  input_summary: string | null;
  output_summary: string | null;
  artifact_refs_json: string;
  data_json: string;
  started_at: string;
  finished_at: string | null;
  created_at: string;
};

export type ToolPermissionStatus = "enabled" | "disabled" | "pending_review";

export type ToolPermissionRow = {
  id: string;
  user_id: string;
  workspace_id: string;
  agent_id: string;
  tool_id: string;
  status: ToolPermissionStatus;
  execution_json: string;
  data_json: string;
  created_at: string;
  updated_at: string;
};

export type ControlPolicyDecisionRow = {
  id: string;
  user_id: string;
  workspace_id: string;
  agent_id: string;
  tool_id: string;
  surface: string;
  decision: string;
  reason: string;
  execution_mode: ExecutionMode;
  policy_reference: string | null;
  data_json: string;
  created_at: string;
};

export type ControlApprovalRequestRow = {
  id: string;
  user_id: string;
  workspace_id: string;
  agent_id: string;
  workflow_intent_id: string;
  run_id: string;
  tool_id: string;
  status: string;
  reason: string;
  data_json: string;
  created_at: string;
  updated_at: string;
};

export type ControlArtifactRow = {
  id: string;
  user_id: string;
  workspace_id: string;
  kind: string;
  uri: string;
  title: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  data_json: string;
  created_at: string;
};

export type ControlDecisionRow = {
  id: string;
  user_id: string;
  workspace_id: string;
  agent_id: string;
  title: string;
  summary: string;
  thesis: string;
  status: string;
  provenance_refs_json: string;
  artifact_refs_json: string;
  created_at: string;
  updated_at: string;
};

export type ControlAuditRow = {
  id: string;
  user_id: string;
  workspace_id: string;
  action: string;
  summary: string;
  target_type: string | null;
  target_id: string | null;
  data_json: string;
  created_at: string;
};

export type ControlPlaneEventRow = {
  id: string;
  user_id: string;
  workspace_id: string;
  agent_id: string;
  type: string;
  summary: string;
  target_type: string | null;
  target_id: string | null;
  data_json: string;
  created_at: string;
};

export type RuntimeTraceRow = {
  trace_id: string;
  user_id: string;
  workspace_id: string;
  agent_id: string;
  kind: string;
  status: string;
  root_name: string;
  summary: string | null;
  bottleneck_span_id: string | null;
  data_json: string;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  created_at: string;
  updated_at: string;
};

export type RuntimeSpanRow = {
  span_id: string;
  trace_id: string;
  parent_span_id: string | null;
  user_id: string;
  workspace_id: string;
  agent_id: string;
  name: string;
  layer: string;
  status: string;
  data_json: string;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  created_at: string;
  updated_at: string;
};

export type ChatSessionRow = {
  session_id: string;
  user_id: string;
  workspace_id: string;
  agent_id: string;
  status: string;
  active_thread_id: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
  last_seen_at: string;
};

export type ChatThreadRow = {
  thread_id: string;
  session_id: string;
  user_id: string;
  workspace_id: string;
  agent_id: string;
  status: string;
  upstream_json: string;
  created_at: string;
  updated_at: string;
  last_seen_at: string;
};

export type ChatIntentRow = {
  id: string;
  session_id: string;
  thread_id: string;
  user_id: string;
  workspace_id: string;
  agent_id: string;
  type: string;
  execution_mode: ExecutionMode;
  status: string;
  payload_json: string;
  created_at: string;
  updated_at: string;
};

export type ChatPolicyDecisionRow = {
  id: string;
  intent_id: string;
  thread_id: string;
  user_id: string;
  workspace_id: string;
  agent_id: string;
  decision: string;
  reason: string;
  execution_mode: ExecutionMode;
  limits_json: string;
  created_at: string;
};

export type ChatRunRow = {
  id: string;
  intent_id: string;
  policy_decision_id: string;
  thread_id: string;
  user_id: string;
  workspace_id: string;
  agent_id: string;
  upstream_run_id: string | null;
  status: string;
  metadata_json: string;
  error: string | null;
  started_at: string;
  completed_at: string | null;
  failed_at: string | null;
  updated_at: string;
};

export const demoExecution = { mode: "dry_run", policy: "dev-demo" };
export const demoWorkflowType = "demo.inspect";

export const allowedStatuses = new Set<RunStatus>([
  "queued",
  "running",
  "waiting",
  "interrupted",
  "completed",
  "failed",
  "cancelled",
]);

export const createId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

export const toJson = (value: unknown) => JSON.stringify(value ?? {});
