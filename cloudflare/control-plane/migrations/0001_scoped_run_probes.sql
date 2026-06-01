CREATE TABLE IF NOT EXISTS run_probes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT,
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, workspace_id, run_id)
);

CREATE INDEX IF NOT EXISTS idx_run_probes_scope_latest
  ON run_probes (user_id, workspace_id, updated_at DESC, id DESC);
