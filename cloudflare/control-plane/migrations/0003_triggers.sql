CREATE TABLE control_triggers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  pack_id TEXT NOT NULL,
  pack_trigger_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  workflow_type TEXT NOT NULL,
  status TEXT NOT NULL,
  execution_json TEXT NOT NULL,
  config_json TEXT NOT NULL,
  input_json TEXT NOT NULL DEFAULT '{}',
  max_concurrent_runs INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  next_trigger_at TEXT,
  last_triggered_at TEXT,
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, workspace_id, agent_id, pack_id, pack_trigger_id)
);

CREATE INDEX idx_control_triggers_scope_latest
  ON control_triggers (user_id, workspace_id, agent_id, updated_at DESC);

CREATE INDEX idx_control_triggers_due
  ON control_triggers (status, next_trigger_at);

CREATE TABLE control_trigger_dispatches (
  id TEXT PRIMARY KEY,
  trigger_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  run_id TEXT,
  previous_run_id TEXT,
  scheduled_for TEXT,
  received_at TEXT NOT NULL,
  lease_owner TEXT,
  lease_expires_at TEXT,
  heartbeat_at TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  error_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (trigger_id, idempotency_key),
  UNIQUE (run_id)
);

CREATE INDEX idx_control_trigger_dispatches_scope_latest
  ON control_trigger_dispatches (user_id, workspace_id, agent_id, created_at DESC);

CREATE INDEX idx_control_trigger_dispatches_recovery
  ON control_trigger_dispatches (status, lease_expires_at);
