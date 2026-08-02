ALTER TABLE control_data_jobs ADD COLUMN last_error_code TEXT;
ALTER TABLE control_data_jobs ADD COLUMN last_failed_at TEXT;
ALTER TABLE control_data_jobs ADD COLUMN manual_retry_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_control_data_jobs_failed_purge
  ON control_data_jobs (workspace_id, kind, status, updated_at DESC)
  WHERE kind = 'purge' AND status = 'failed';
