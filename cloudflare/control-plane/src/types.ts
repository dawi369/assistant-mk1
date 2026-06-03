export type RunStatus =
  | "queued"
  | "running"
  | "waiting"
  | "interrupted"
  | "completed"
  | "failed"
  | "cancelled";

export type D1PreparedStatement = {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
};

export type D1Database = {
  prepare(query: string): D1PreparedStatement;
};

export type Env = {
  DB: D1Database;
  CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN?: string;
  LANGGRAPH_UPSTREAM_URL?: string;
  LANGGRAPH_UPSTREAM_TOKEN?: string;
  WORKBENCH_EXECUTOR_URL?: string;
  WORKBENCH_EXECUTOR_TOKEN?: string;
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

export type ChatThreadRow = {
  thread_id: string;
  user_id: string;
  workspace_id: string;
  agent_id: string;
  status: string;
  upstream_json: string;
  created_at: string;
  updated_at: string;
  last_seen_at: string;
};

export type ChatRunRow = {
  id: string;
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
