INSERT INTO users (id, email, display_name, status, data_json, created_at, updated_at)
VALUES (
  'e2e-owner',
  'owner@example.com',
  'Release Test Owner',
  'active',
  '{}',
  '2026-07-09T20:00:00.000Z',
  '2026-07-09T20:00:00.000Z'
);

INSERT INTO workspaces (
  id, account_id, account_source, name, status, is_default, created_by_user_id,
  data_json, created_at, updated_at
)
VALUES (
  'e2e-workspace',
  'local-dev:e2e-workspace',
  'local-dev',
  'Release Workspace',
  'active',
  1,
  'e2e-owner',
  '{}',
  '2026-07-09T20:00:00.000Z',
  '2026-07-09T20:00:00.000Z'
);

INSERT INTO memberships (
  id, user_id, workspace_id, role, status, roles_json, permissions_json, data_json,
  created_at, updated_at
)
VALUES (
  'e2e-membership-owner',
  'e2e-owner',
  'e2e-workspace',
  'owner',
  'active',
  '["owner"]',
  '[]',
  '{"provider":"local-dev"}',
  '2026-07-09T20:00:00.000Z',
  '2026-07-09T20:00:00.000Z'
);

INSERT INTO agents (
  id, workspace_id, name, description, status, is_default, created_by_user_id,
  data_json, created_at, updated_at
)
VALUES (
  'e2e-agent',
  'e2e-workspace',
  'Release Assistant',
  'Deterministic local browser release fixture.',
  'active',
  1,
  'e2e-owner',
  '{"profile":"default"}',
  '2026-07-09T20:00:00.000Z',
  '2026-07-09T20:00:00.000Z'
);

INSERT INTO control_workflow_intents (
  id, user_id, workspace_id, agent_id, stage, type, execution_json, payload_json,
  status, created_at, updated_at
)
VALUES (
  'e2e-retry-intent',
  'e2e-owner',
  'e2e-workspace',
  'e2e-agent',
  'failed',
  'polymancer.market_research',
  '{"mode":"dry_run"}',
  '{"market":"Will the release pass?","maxMarkets":5}',
  'failed',
  '2026-07-09T20:05:00.000Z',
  '2026-07-09T20:05:00.000Z'
);

INSERT INTO control_runs (
  id, user_id, workspace_id, agent_id, workflow_intent_id, status, execution_json,
  stage, engine, heartbeat_at, last_event_at, completed_at, failed_at, data_json,
  created_at, updated_at
)
VALUES (
  'e2e-retry-run',
  'e2e-owner',
  'e2e-workspace',
  'e2e-agent',
  'e2e-retry-intent',
  'failed',
  '{"mode":"dry_run"}',
  'failed',
  'cloudflare-workflow',
  NULL,
  '2026-07-09T20:05:00.000Z',
  NULL,
  '2026-07-09T20:05:00.000Z',
  '{"displayName":"Release recovery fixture","summary":"A failed retryable run used to verify normal-surface recovery controls."}',
  '2026-07-09T20:05:00.000Z',
  '2026-07-09T20:05:00.000Z'
);
