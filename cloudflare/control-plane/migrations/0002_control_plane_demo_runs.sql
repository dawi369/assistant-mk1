CREATE TABLE IF NOT EXISTS control_workflow_intents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  type TEXT NOT NULL,
  execution_json TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS control_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  workflow_intent_id TEXT NOT NULL,
  status TEXT NOT NULL,
  execution_json TEXT NOT NULL,
  stage TEXT,
  engine TEXT,
  heartbeat_at TEXT,
  last_event_at TEXT,
  completed_at TEXT,
  failed_at TEXT,
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_control_runs_scope_latest
  ON control_runs (user_id, workspace_id, updated_at DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS control_tool_calls (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  workflow_intent_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  status TEXT NOT NULL,
  input_summary TEXT,
  output_summary TEXT,
  artifact_refs_json TEXT NOT NULL DEFAULT '[]',
  data_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT NOT NULL,
  finished_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_control_tool_calls_run
  ON control_tool_calls (user_id, workspace_id, run_id, created_at ASC);

CREATE TABLE IF NOT EXISTS control_artifacts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  uri TEXT NOT NULL,
  title TEXT,
  mime_type TEXT,
  size_bytes INTEGER,
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS control_decisions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  thesis TEXT NOT NULL,
  status TEXT NOT NULL,
  provenance_refs_json TEXT NOT NULL DEFAULT '[]',
  artifact_refs_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS control_audit_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  action TEXT NOT NULL,
  summary TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_control_audit_scope_time
  ON control_audit_events (user_id, workspace_id, created_at ASC);
