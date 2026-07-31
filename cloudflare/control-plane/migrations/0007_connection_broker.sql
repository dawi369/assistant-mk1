CREATE TABLE control_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  pack_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  principal TEXT NOT NULL CHECK (principal IN ('app', 'user')),
  credential_class TEXT NOT NULL CHECK (credential_class IN ('oauth2', 'api_key')),
  status TEXT NOT NULL CHECK (status IN ('authorization_required', 'authorized', 'refresh_required', 'unhealthy', 'revoked')),
  scopes_json TEXT NOT NULL DEFAULT '[]',
  vault_object_id TEXT,
  vault_version TEXT,
  token_expires_at TEXT,
  refresh_lease_owner TEXT,
  refresh_lease_expires_at TEXT,
  last_used_at TEXT,
  last_health_at TEXT,
  last_error_code TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revoked_at TEXT,
  UNIQUE (user_id, workspace_id, agent_id, pack_id, connection_id)
);

CREATE INDEX idx_control_connections_scope
  ON control_connections (user_id, workspace_id, agent_id, status, updated_at DESC);

CREATE TABLE control_connection_oauth_states (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  connection_record_id TEXT NOT NULL,
  state_hash TEXT NOT NULL UNIQUE,
  pkce_verifier_vault_object_id TEXT NOT NULL,
  pkce_verifier_vault_version TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_control_connection_oauth_states_expiry
  ON control_connection_oauth_states (expires_at, used_at);
