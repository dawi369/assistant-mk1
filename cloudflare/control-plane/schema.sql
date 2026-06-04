DROP TABLE IF EXISTS chat_runs;
DROP TABLE IF EXISTS chat_policy_decisions;
DROP TABLE IF EXISTS chat_intents;
DROP TABLE IF EXISTS chat_threads;
DROP TABLE IF EXISTS chat_sessions;
DROP TABLE IF EXISTS control_plane_events;
DROP TABLE IF EXISTS control_audit_events;
DROP TABLE IF EXISTS control_decisions;
DROP TABLE IF EXISTS control_artifacts;
DROP TABLE IF EXISTS control_tool_calls;
DROP TABLE IF EXISTS control_runs;
DROP TABLE IF EXISTS control_workflow_intents;

CREATE TABLE control_workflow_intents (
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

CREATE TABLE control_runs (
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

CREATE INDEX idx_control_runs_scope_latest
  ON control_runs (user_id, workspace_id, updated_at DESC, created_at DESC);

CREATE TABLE control_tool_calls (
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

CREATE INDEX idx_control_tool_calls_run
  ON control_tool_calls (user_id, workspace_id, run_id, created_at ASC);

CREATE TABLE control_artifacts (
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

CREATE TABLE control_decisions (
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

CREATE TABLE control_audit_events (
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

CREATE INDEX idx_control_audit_scope_time
  ON control_audit_events (user_id, workspace_id, created_at ASC);

CREATE TABLE control_plane_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  type TEXT NOT NULL,
  summary TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX idx_control_plane_events_scope_latest
  ON control_plane_events (user_id, workspace_id, created_at DESC, id DESC);

CREATE TABLE chat_sessions (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  status TEXT NOT NULL,
  active_thread_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE INDEX idx_chat_sessions_scope_latest
  ON chat_sessions (user_id, workspace_id, updated_at DESC, created_at DESC);

CREATE TABLE chat_threads (
  thread_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  status TEXT NOT NULL,
  upstream_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE INDEX idx_chat_threads_scope_latest
  ON chat_threads (user_id, workspace_id, updated_at DESC, created_at DESC);

CREATE INDEX idx_chat_threads_session_latest
  ON chat_threads (user_id, workspace_id, session_id, updated_at DESC, created_at DESC);

CREATE TABLE chat_intents (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  type TEXT NOT NULL,
  execution_mode TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_chat_intents_thread_latest
  ON chat_intents (user_id, workspace_id, thread_id, updated_at DESC, created_at DESC);

CREATE TABLE chat_policy_decisions (
  id TEXT PRIMARY KEY,
  intent_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  reason TEXT NOT NULL,
  execution_mode TEXT NOT NULL,
  limits_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX idx_chat_policy_decisions_thread_latest
  ON chat_policy_decisions (user_id, workspace_id, thread_id, created_at DESC);

CREATE TABLE chat_runs (
  id TEXT PRIMARY KEY,
  intent_id TEXT NOT NULL,
  policy_decision_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  upstream_run_id TEXT,
  status TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  error TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  failed_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_chat_runs_thread_latest
  ON chat_runs (user_id, workspace_id, thread_id, updated_at DESC, started_at DESC);
