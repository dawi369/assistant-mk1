ALTER TABLE workspaces ADD COLUMN deletion_requested_by_user_id TEXT;
ALTER TABLE workspaces ADD COLUMN deletion_requested_at TEXT;
ALTER TABLE workspaces ADD COLUMN purge_after TEXT;
ALTER TABLE workspaces ADD COLUMN purged_at TEXT;

ALTER TABLE control_retention_policies ADD COLUMN chat_message_retention_days INTEGER NOT NULL DEFAULT 90
  CHECK (chat_message_retention_days BETWEEN 1 AND 3650);
ALTER TABLE control_retention_policies ADD COLUMN run_payload_retention_days INTEGER NOT NULL DEFAULT 90
  CHECK (run_payload_retention_days BETWEEN 1 AND 3650);
ALTER TABLE control_retention_policies ADD COLUMN audit_action_retention_days INTEGER NOT NULL DEFAULT 365
  CHECK (audit_action_retention_days BETWEEN 365 AND 3650);
ALTER TABLE control_retention_policies ADD COLUMN confirmed_at TEXT;
ALTER TABLE control_retention_policies ADD COLUMN confirmed_by_user_id TEXT;

CREATE UNIQUE INDEX idx_control_retention_policies_workspace
  ON control_retention_policies (workspace_id);

DROP TRIGGER control_artifacts_default_expiry;
CREATE TRIGGER control_artifacts_default_expiry
AFTER INSERT ON control_artifacts
WHEN NEW.retention_class = 'standard' AND NEW.expires_at IS NULL
BEGIN
  UPDATE control_artifacts
  SET expires_at = strftime(
    '%Y-%m-%dT%H:%M:%fZ',
    NEW.created_at,
    '+' || COALESCE(
      (
        SELECT artifact_retention_days
        FROM control_retention_policies
        WHERE workspace_id = NEW.workspace_id
      ),
      90
    ) || ' days'
  )
  WHERE id = NEW.id;
END;

CREATE TABLE control_data_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('export', 'purge')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled', 'expired')),
  cursor_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT NOT NULL DEFAULT '{}',
  error_json TEXT NOT NULL DEFAULT '{}',
  storage_key TEXT,
  content_sha256 TEXT,
  size_bytes INTEGER,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT,
  lease_expires_at TEXT,
  expires_at TEXT,
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX idx_control_data_jobs_scope_latest
  ON control_data_jobs (user_id, workspace_id, created_at DESC);

CREATE INDEX idx_control_data_jobs_runnable
  ON control_data_jobs (status, lease_expires_at, created_at)
  WHERE status IN ('queued', 'running');

CREATE INDEX idx_workspaces_purge_due
  ON workspaces (status, purge_after)
  WHERE status = 'quarantined' AND purge_after IS NOT NULL;
