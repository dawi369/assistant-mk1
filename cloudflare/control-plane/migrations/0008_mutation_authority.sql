CREATE TABLE control_action_proposals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  workflow_intent_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  tool_call_id TEXT,
  pack_id TEXT NOT NULL,
  pack_version TEXT NOT NULL,
  runtime_version TEXT NOT NULL,
  binding_version INTEGER NOT NULL,
  tool_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  connection_record_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('proposed', 'approval_requested', 'approved', 'executing', 'executed', 'failed', 'outcome_unknown', 'reconciled', 'cancelled', 'expired')),
  summary TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  input_sha256 TEXT NOT NULL,
  proposal_json TEXT NOT NULL,
  policy_decision_id TEXT,
  approval_request_id TEXT,
  external_reference TEXT,
  result_json TEXT NOT NULL DEFAULT '{}',
  error_json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  terminal_at TEXT,
  UNIQUE (user_id, workspace_id, tool_id, idempotency_key)
);

CREATE INDEX idx_control_action_proposals_scope_latest
  ON control_action_proposals (user_id, workspace_id, status, created_at DESC);

CREATE TABLE control_action_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('proposed', 'approved', 'blocked', 'executing', 'executed', 'failed', 'outcome_unknown', 'reconciled', 'cancelled', 'reviewed')),
  summary TEXT NOT NULL,
  request_sha256 TEXT,
  response_sha256 TEXT,
  external_reference TEXT,
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE (proposal_id, sequence)
);

CREATE INDEX idx_control_action_ledger_scope_latest
  ON control_action_ledger (user_id, workspace_id, created_at DESC);

CREATE TABLE control_kill_switches (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('workspace', 'pack', 'tool', 'connection')),
  scope_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  reason TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, workspace_id, scope_kind, scope_id)
);

CREATE INDEX idx_control_kill_switches_scope
  ON control_kill_switches (user_id, workspace_id, enabled, scope_kind, scope_id);
