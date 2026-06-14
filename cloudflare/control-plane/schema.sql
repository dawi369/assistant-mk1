DROP TABLE IF EXISTS runtime_spans;
DROP TABLE IF EXISTS runtime_traces;
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
DROP TABLE IF EXISTS control_approval_requests;
DROP TABLE IF EXISTS control_runs;
DROP TABLE IF EXISTS control_workflow_intents;
DROP TABLE IF EXISTS control_policy_decisions;
DROP TABLE IF EXISTS tool_permissions;
DROP TABLE IF EXISTS active_agent_preferences;
DROP TABLE IF EXISTS agents;
DROP TABLE IF EXISTS memberships;
DROP TABLE IF EXISTS active_workspace_preferences;
DROP TABLE IF EXISTS workspaces;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT,
  display_name TEXT,
  status TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  account_source TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_by_user_id TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_workspaces_account_default
  ON workspaces (account_id, is_default)
  WHERE is_default = 1;

CREATE INDEX idx_workspaces_account
  ON workspaces (account_id, status, is_default DESC, created_at ASC);

CREATE TABLE active_workspace_preferences (
  user_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, account_id)
);

CREATE INDEX idx_active_workspace_preferences_workspace
  ON active_workspace_preferences (workspace_id);

CREATE TABLE memberships (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL,
  roles_json TEXT NOT NULL DEFAULT '[]',
  permissions_json TEXT NOT NULL DEFAULT '[]',
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, workspace_id)
);

CREATE INDEX idx_memberships_scope
  ON memberships (user_id, workspace_id, status);

CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_by_user_id TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_agents_workspace_default
  ON agents (workspace_id, is_default)
  WHERE is_default = 1;

CREATE INDEX idx_agents_workspace_active
  ON agents (workspace_id, status, is_default DESC, created_at ASC);

CREATE TABLE active_agent_preferences (
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, workspace_id)
);

CREATE INDEX idx_active_agent_preferences_agent
  ON active_agent_preferences (agent_id);

CREATE TABLE tool_permissions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  status TEXT NOT NULL,
  execution_json TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, workspace_id, agent_id, tool_id)
);

CREATE INDEX idx_tool_permissions_scope
  ON tool_permissions (user_id, workspace_id, agent_id, status);

CREATE TABLE control_policy_decisions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  surface TEXT NOT NULL,
  decision TEXT NOT NULL,
  reason TEXT NOT NULL,
  execution_mode TEXT NOT NULL,
  policy_reference TEXT,
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX idx_control_policy_decisions_scope_latest
  ON control_policy_decisions (user_id, workspace_id, created_at DESC);

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

CREATE TABLE control_approval_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  workflow_intent_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_control_approval_requests_scope_latest
  ON control_approval_requests (user_id, workspace_id, updated_at DESC, created_at DESC);

CREATE INDEX idx_control_approval_requests_run
  ON control_approval_requests (user_id, workspace_id, run_id, created_at ASC);

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

CREATE TABLE runtime_traces (
  trace_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  root_name TEXT NOT NULL,
  summary TEXT,
  bottleneck_span_id TEXT,
  data_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_ms INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_runtime_traces_scope_latest
  ON runtime_traces (user_id, workspace_id, updated_at DESC, started_at DESC);

CREATE TABLE runtime_spans (
  span_id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL,
  parent_span_id TEXT,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  name TEXT NOT NULL,
  layer TEXT NOT NULL,
  status TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_ms INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_runtime_spans_trace_time
  ON runtime_spans (user_id, workspace_id, trace_id, started_at ASC, created_at ASC);

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
