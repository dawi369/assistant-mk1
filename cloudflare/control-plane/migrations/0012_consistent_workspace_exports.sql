CREATE TABLE control_workspace_write_fences (
  workspace_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('active', 'releasing')),
  lease_owner TEXT NOT NULL,
  lease_expires_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  acquired_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_control_workspace_write_fences_lease
  ON control_workspace_write_fences (status, lease_expires_at);

CREATE TABLE control_data_export_rows (
  job_id TEXT NOT NULL,
  collection_name TEXT NOT NULL,
  row_key TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (job_id, collection_name, row_key)
);

CREATE INDEX idx_control_data_export_rows_page
  ON control_data_export_rows (job_id, collection_name, row_key);

CREATE TABLE control_data_export_objects (
  job_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  size_bytes INTEGER,
  status TEXT NOT NULL CHECK (status IN ('pinned', 'verified')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (job_id, artifact_id)
);

CREATE INDEX idx_control_data_export_objects_storage
  ON control_data_export_objects (storage_key, status);

CREATE TRIGGER export_fence_users_update
BEFORE UPDATE ON users
WHEN EXISTS (
  SELECT 1 FROM memberships membership
  JOIN control_workspace_write_fences fence
    ON fence.workspace_id = membership.workspace_id
  WHERE membership.user_id = OLD.id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;
CREATE TRIGGER export_fence_users_delete
BEFORE DELETE ON users
WHEN EXISTS (
  SELECT 1 FROM memberships membership
  JOIN control_workspace_write_fences fence
    ON fence.workspace_id = membership.workspace_id
  WHERE membership.user_id = OLD.id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_workspaces_update
BEFORE UPDATE ON workspaces
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = OLD.id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_workspaces_delete
BEFORE DELETE ON workspaces
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = OLD.id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;


CREATE TRIGGER export_fence_active_workspace_preferences_insert
BEFORE INSERT ON active_workspace_preferences
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = NEW.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_active_workspace_preferences_update
BEFORE UPDATE ON active_workspace_preferences
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id IN (OLD.workspace_id, NEW.workspace_id)
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_active_workspace_preferences_delete
BEFORE DELETE ON active_workspace_preferences
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = OLD.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;


CREATE TRIGGER export_fence_memberships_insert
BEFORE INSERT ON memberships
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = NEW.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_memberships_update
BEFORE UPDATE ON memberships
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id IN (OLD.workspace_id, NEW.workspace_id)
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_memberships_delete
BEFORE DELETE ON memberships
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = OLD.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;


CREATE TRIGGER export_fence_agents_insert
BEFORE INSERT ON agents
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = NEW.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_agents_update
BEFORE UPDATE ON agents
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id IN (OLD.workspace_id, NEW.workspace_id)
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_agents_delete
BEFORE DELETE ON agents
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = OLD.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;


CREATE TRIGGER export_fence_active_agent_preferences_insert
BEFORE INSERT ON active_agent_preferences
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = NEW.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_active_agent_preferences_update
BEFORE UPDATE ON active_agent_preferences
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id IN (OLD.workspace_id, NEW.workspace_id)
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_active_agent_preferences_delete
BEFORE DELETE ON active_agent_preferences
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = OLD.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;


CREATE TRIGGER export_fence_tool_permissions_insert
BEFORE INSERT ON tool_permissions
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = NEW.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_tool_permissions_update
BEFORE UPDATE ON tool_permissions
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id IN (OLD.workspace_id, NEW.workspace_id)
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_tool_permissions_delete
BEFORE DELETE ON tool_permissions
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = OLD.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;


CREATE TRIGGER export_fence_control_policy_decisions_insert
BEFORE INSERT ON control_policy_decisions
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = NEW.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_control_policy_decisions_update
BEFORE UPDATE ON control_policy_decisions
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id IN (OLD.workspace_id, NEW.workspace_id)
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_control_policy_decisions_delete
BEFORE DELETE ON control_policy_decisions
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = OLD.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;


CREATE TRIGGER export_fence_control_workflow_intents_insert
BEFORE INSERT ON control_workflow_intents
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = NEW.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_control_workflow_intents_update
BEFORE UPDATE ON control_workflow_intents
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id IN (OLD.workspace_id, NEW.workspace_id)
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_control_workflow_intents_delete
BEFORE DELETE ON control_workflow_intents
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = OLD.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;


CREATE TRIGGER export_fence_control_runs_insert
BEFORE INSERT ON control_runs
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = NEW.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_control_runs_update
BEFORE UPDATE ON control_runs
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id IN (OLD.workspace_id, NEW.workspace_id)
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_control_runs_delete
BEFORE DELETE ON control_runs
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = OLD.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;


CREATE TRIGGER export_fence_control_approval_requests_insert
BEFORE INSERT ON control_approval_requests
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = NEW.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_control_approval_requests_update
BEFORE UPDATE ON control_approval_requests
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id IN (OLD.workspace_id, NEW.workspace_id)
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_control_approval_requests_delete
BEFORE DELETE ON control_approval_requests
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = OLD.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;


CREATE TRIGGER export_fence_control_tool_calls_insert
BEFORE INSERT ON control_tool_calls
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = NEW.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_control_tool_calls_update
BEFORE UPDATE ON control_tool_calls
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id IN (OLD.workspace_id, NEW.workspace_id)
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_control_tool_calls_delete
BEFORE DELETE ON control_tool_calls
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = OLD.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;


CREATE TRIGGER export_fence_control_artifacts_insert
BEFORE INSERT ON control_artifacts
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = NEW.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_control_artifacts_update
BEFORE UPDATE ON control_artifacts
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id IN (OLD.workspace_id, NEW.workspace_id)
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_control_artifacts_delete
BEFORE DELETE ON control_artifacts
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = OLD.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;


CREATE TRIGGER export_fence_control_retention_policies_insert
BEFORE INSERT ON control_retention_policies
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = NEW.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_control_retention_policies_update
BEFORE UPDATE ON control_retention_policies
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id IN (OLD.workspace_id, NEW.workspace_id)
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_control_retention_policies_delete
BEFORE DELETE ON control_retention_policies
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = OLD.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;


CREATE TRIGGER export_fence_control_connections_insert
BEFORE INSERT ON control_connections
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = NEW.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_control_connections_update
BEFORE UPDATE ON control_connections
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id IN (OLD.workspace_id, NEW.workspace_id)
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_control_connections_delete
BEFORE DELETE ON control_connections
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = OLD.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;


CREATE TRIGGER export_fence_control_action_proposals_insert
BEFORE INSERT ON control_action_proposals
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = NEW.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_control_action_proposals_update
BEFORE UPDATE ON control_action_proposals
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id IN (OLD.workspace_id, NEW.workspace_id)
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_control_action_proposals_delete
BEFORE DELETE ON control_action_proposals
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = OLD.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;


CREATE TRIGGER export_fence_control_action_ledger_insert
BEFORE INSERT ON control_action_ledger
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = NEW.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_control_action_ledger_update
BEFORE UPDATE ON control_action_ledger
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id IN (OLD.workspace_id, NEW.workspace_id)
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_control_action_ledger_delete
BEFORE DELETE ON control_action_ledger
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = OLD.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;


CREATE TRIGGER export_fence_control_kill_switches_insert
BEFORE INSERT ON control_kill_switches
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = NEW.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_control_kill_switches_update
BEFORE UPDATE ON control_kill_switches
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id IN (OLD.workspace_id, NEW.workspace_id)
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_control_kill_switches_delete
BEFORE DELETE ON control_kill_switches
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = OLD.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;


CREATE TRIGGER export_fence_control_operator_alerts_insert
BEFORE INSERT ON control_operator_alerts
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = NEW.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_control_operator_alerts_update
BEFORE UPDATE ON control_operator_alerts
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id IN (OLD.workspace_id, NEW.workspace_id)
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_control_operator_alerts_delete
BEFORE DELETE ON control_operator_alerts
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = OLD.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;


CREATE TRIGGER export_fence_control_decisions_insert
BEFORE INSERT ON control_decisions
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = NEW.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_control_decisions_update
BEFORE UPDATE ON control_decisions
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id IN (OLD.workspace_id, NEW.workspace_id)
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_control_decisions_delete
BEFORE DELETE ON control_decisions
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = OLD.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;


CREATE TRIGGER export_fence_control_managed_state_insert
BEFORE INSERT ON control_managed_state
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = NEW.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_control_managed_state_update
BEFORE UPDATE ON control_managed_state
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id IN (OLD.workspace_id, NEW.workspace_id)
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_control_managed_state_delete
BEFORE DELETE ON control_managed_state
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = OLD.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;


CREATE TRIGGER export_fence_control_triggers_insert
BEFORE INSERT ON control_triggers
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = NEW.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_control_triggers_update
BEFORE UPDATE ON control_triggers
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id IN (OLD.workspace_id, NEW.workspace_id)
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_control_triggers_delete
BEFORE DELETE ON control_triggers
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = OLD.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;


CREATE TRIGGER export_fence_control_trigger_dispatches_insert
BEFORE INSERT ON control_trigger_dispatches
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = NEW.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_control_trigger_dispatches_update
BEFORE UPDATE ON control_trigger_dispatches
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id IN (OLD.workspace_id, NEW.workspace_id)
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_control_trigger_dispatches_delete
BEFORE DELETE ON control_trigger_dispatches
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = OLD.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;


CREATE TRIGGER export_fence_control_audit_events_insert
BEFORE INSERT ON control_audit_events
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = NEW.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_control_audit_events_update
BEFORE UPDATE ON control_audit_events
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id IN (OLD.workspace_id, NEW.workspace_id)
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_control_audit_events_delete
BEFORE DELETE ON control_audit_events
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = OLD.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;


CREATE TRIGGER export_fence_control_plane_events_insert
BEFORE INSERT ON control_plane_events
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = NEW.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_control_plane_events_update
BEFORE UPDATE ON control_plane_events
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id IN (OLD.workspace_id, NEW.workspace_id)
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_control_plane_events_delete
BEFORE DELETE ON control_plane_events
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = OLD.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;


CREATE TRIGGER export_fence_runtime_traces_insert
BEFORE INSERT ON runtime_traces
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = NEW.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_runtime_traces_update
BEFORE UPDATE ON runtime_traces
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id IN (OLD.workspace_id, NEW.workspace_id)
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_runtime_traces_delete
BEFORE DELETE ON runtime_traces
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = OLD.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;


CREATE TRIGGER export_fence_runtime_spans_insert
BEFORE INSERT ON runtime_spans
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = NEW.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_runtime_spans_update
BEFORE UPDATE ON runtime_spans
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id IN (OLD.workspace_id, NEW.workspace_id)
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_runtime_spans_delete
BEFORE DELETE ON runtime_spans
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = OLD.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;


CREATE TRIGGER export_fence_chat_sessions_insert
BEFORE INSERT ON chat_sessions
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = NEW.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_chat_sessions_update
BEFORE UPDATE ON chat_sessions
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id IN (OLD.workspace_id, NEW.workspace_id)
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_chat_sessions_delete
BEFORE DELETE ON chat_sessions
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = OLD.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;


CREATE TRIGGER export_fence_chat_threads_insert
BEFORE INSERT ON chat_threads
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = NEW.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_chat_threads_update
BEFORE UPDATE ON chat_threads
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id IN (OLD.workspace_id, NEW.workspace_id)
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_chat_threads_delete
BEFORE DELETE ON chat_threads
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = OLD.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;


CREATE TRIGGER export_fence_chat_intents_insert
BEFORE INSERT ON chat_intents
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = NEW.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_chat_intents_update
BEFORE UPDATE ON chat_intents
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id IN (OLD.workspace_id, NEW.workspace_id)
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_chat_intents_delete
BEFORE DELETE ON chat_intents
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = OLD.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;


CREATE TRIGGER export_fence_chat_policy_decisions_insert
BEFORE INSERT ON chat_policy_decisions
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = NEW.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_chat_policy_decisions_update
BEFORE UPDATE ON chat_policy_decisions
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id IN (OLD.workspace_id, NEW.workspace_id)
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_chat_policy_decisions_delete
BEFORE DELETE ON chat_policy_decisions
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = OLD.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;


CREATE TRIGGER export_fence_chat_runs_insert
BEFORE INSERT ON chat_runs
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = NEW.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_chat_runs_update
BEFORE UPDATE ON chat_runs
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id IN (OLD.workspace_id, NEW.workspace_id)
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;

CREATE TRIGGER export_fence_chat_runs_delete
BEFORE DELETE ON chat_runs
WHEN EXISTS (
  SELECT 1 FROM control_workspace_write_fences fence
  WHERE fence.workspace_id = OLD.workspace_id
    AND fence.status = 'active'
    AND fence.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_export_in_progress');
END;
