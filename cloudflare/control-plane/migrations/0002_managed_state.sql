CREATE TABLE control_managed_state (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  state_type TEXT NOT NULL,
  state_key TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  artifact_refs_json TEXT NOT NULL DEFAULT '[]',
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, workspace_id, agent_id, namespace, state_type, state_key)
);

CREATE INDEX idx_control_managed_state_scope_latest
  ON control_managed_state (
    user_id, workspace_id, agent_id, namespace, state_type, updated_at DESC
  );
