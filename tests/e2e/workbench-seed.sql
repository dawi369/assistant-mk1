-- Identity, workspace, membership, agent, and active preferences are intentionally
-- absent. The first trusted local browser request must bootstrap them.

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
  'cloudflare',
  NULL,
  '2026-07-09T20:05:00.000Z',
  NULL,
  '2026-07-09T20:05:00.000Z',
  '{"displayName":"Release recovery fixture","summary":"A failed retryable run used to verify normal-surface recovery controls."}',
  '2026-07-09T20:05:00.000Z',
  '2026-07-09T20:05:00.000Z'
);
