CREATE TABLE control_connection_capabilities (
  id TEXT PRIMARY KEY,
  token_sha256 TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  connection_record_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  workflow_intent_id TEXT NOT NULL,
  tool_call_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  allowed_url TEXT NOT NULL,
  allowed_method TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_control_connection_capabilities_expiry
  ON control_connection_capabilities (expires_at, consumed_at);

CREATE INDEX idx_control_connection_capabilities_scope
  ON control_connection_capabilities (user_id, workspace_id, run_id, tool_call_id);
