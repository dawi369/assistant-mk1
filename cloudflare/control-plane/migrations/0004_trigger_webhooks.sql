ALTER TABLE control_triggers ADD COLUMN public_id TEXT;
ALTER TABLE control_triggers ADD COLUMN secret_hash TEXT;

CREATE UNIQUE INDEX idx_control_triggers_public_id
  ON control_triggers (public_id)
  WHERE public_id IS NOT NULL;
