CREATE TABLE control_client_devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  provider TEXT NOT NULL CHECK (provider = 'expo'),
  vault_object_id TEXT NOT NULL,
  vault_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled', 'revoked')),
  last_seen_at TEXT NOT NULL,
  app_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revoked_at TEXT,
  UNIQUE (user_id, workspace_id, installation_id)
);

CREATE INDEX idx_control_client_devices_scope
  ON control_client_devices (user_id, workspace_id, status, updated_at DESC);

CREATE TABLE control_notification_preferences (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  approval_required INTEGER NOT NULL DEFAULT 1 CHECK (approval_required IN (0, 1)),
  terminal_outcomes INTEGER NOT NULL DEFAULT 1 CHECK (terminal_outcomes IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, workspace_id)
);

CREATE TABLE control_notification_deliveries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  route TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'sent', 'delivered', 'failed', 'expired')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  provider_ticket_id TEXT,
  last_error_code TEXT,
  expires_at TEXT NOT NULL,
  delivered_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (device_id, event_type, target_type, target_id)
);

CREATE INDEX idx_control_notification_deliveries_pending
  ON control_notification_deliveries (status, expires_at, updated_at);

CREATE INDEX idx_control_notification_deliveries_scope
  ON control_notification_deliveries (user_id, workspace_id, created_at DESC);

CREATE TRIGGER export_fence_control_client_devices_insert
BEFORE INSERT ON control_client_devices
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = NEW.workspace_id AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN SELECT RAISE(ABORT, 'workspace_export_in_progress'); END;

CREATE TRIGGER export_fence_control_client_devices_update
BEFORE UPDATE ON control_client_devices
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id IN (OLD.workspace_id, NEW.workspace_id) AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN SELECT RAISE(ABORT, 'workspace_export_in_progress'); END;

CREATE TRIGGER export_fence_control_client_devices_delete
BEFORE DELETE ON control_client_devices
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = OLD.workspace_id AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN SELECT RAISE(ABORT, 'workspace_export_in_progress'); END;

CREATE TRIGGER export_fence_control_notification_preferences_insert
BEFORE INSERT ON control_notification_preferences
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = NEW.workspace_id AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN SELECT RAISE(ABORT, 'workspace_export_in_progress'); END;

CREATE TRIGGER export_fence_control_notification_preferences_update
BEFORE UPDATE ON control_notification_preferences
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id IN (OLD.workspace_id, NEW.workspace_id) AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN SELECT RAISE(ABORT, 'workspace_export_in_progress'); END;

CREATE TRIGGER export_fence_control_notification_preferences_delete
BEFORE DELETE ON control_notification_preferences
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = OLD.workspace_id AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN SELECT RAISE(ABORT, 'workspace_export_in_progress'); END;

CREATE TRIGGER export_fence_control_notification_deliveries_insert
BEFORE INSERT ON control_notification_deliveries
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = NEW.workspace_id AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN SELECT RAISE(ABORT, 'workspace_export_in_progress'); END;

CREATE TRIGGER export_fence_control_notification_deliveries_update
BEFORE UPDATE ON control_notification_deliveries
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id IN (OLD.workspace_id, NEW.workspace_id) AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN SELECT RAISE(ABORT, 'workspace_export_in_progress'); END;

CREATE TRIGGER export_fence_control_notification_deliveries_delete
BEFORE DELETE ON control_notification_deliveries
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = OLD.workspace_id AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN SELECT RAISE(ABORT, 'workspace_export_in_progress'); END;
