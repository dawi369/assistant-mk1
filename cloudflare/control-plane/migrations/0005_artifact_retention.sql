ALTER TABLE control_artifacts ADD COLUMN storage_provider TEXT NOT NULL DEFAULT 'external';
ALTER TABLE control_artifacts ADD COLUMN storage_key TEXT;
ALTER TABLE control_artifacts ADD COLUMN content_sha256 TEXT;
ALTER TABLE control_artifacts ADD COLUMN retention_class TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE control_artifacts ADD COLUMN expires_at TEXT;
ALTER TABLE control_artifacts ADD COLUMN deleted_at TEXT;

CREATE INDEX idx_control_artifacts_expiry
  ON control_artifacts (expires_at, created_at)
  WHERE deleted_at IS NULL AND expires_at IS NOT NULL;

CREATE TABLE control_retention_policies (
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  artifact_retention_days INTEGER NOT NULL DEFAULT 90
    CHECK (artifact_retention_days BETWEEN 1 AND 3650),
  operational_event_retention_days INTEGER NOT NULL DEFAULT 30
    CHECK (operational_event_retention_days BETWEEN 1 AND 3650),
  runtime_trace_retention_days INTEGER NOT NULL DEFAULT 14
    CHECK (runtime_trace_retention_days BETWEEN 1 AND 3650),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, workspace_id)
);

UPDATE control_artifacts
SET expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+90 days')
WHERE retention_class = 'standard' AND expires_at IS NULL;

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
        WHERE user_id = NEW.user_id AND workspace_id = NEW.workspace_id
      ),
      90
    ) || ' days'
  )
  WHERE id = NEW.id;
END;

CREATE TABLE control_operator_alerts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  agent_id TEXT,
  severity TEXT NOT NULL,
  code TEXT NOT NULL,
  summary TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  dedup_key TEXT NOT NULL,
  delivery_status TEXT NOT NULL DEFAULT 'pending',
  delivery_attempts INTEGER NOT NULL DEFAULT 0,
  last_delivery_at TEXT,
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, workspace_id, dedup_key)
);

CREATE INDEX idx_control_operator_alerts_delivery
  ON control_operator_alerts (delivery_status, delivery_attempts, created_at)
  WHERE status = 'open';

CREATE INDEX idx_control_operator_alerts_scope
  ON control_operator_alerts (user_id, workspace_id, status, created_at DESC);
