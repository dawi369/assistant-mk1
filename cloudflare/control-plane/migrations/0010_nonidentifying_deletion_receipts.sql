CREATE TABLE control_deletion_receipts (
  receipt_sha256 TEXT PRIMARY KEY,
  completed_at TEXT NOT NULL
);

CREATE INDEX idx_control_deletion_receipts_completed
  ON control_deletion_receipts (completed_at DESC);
