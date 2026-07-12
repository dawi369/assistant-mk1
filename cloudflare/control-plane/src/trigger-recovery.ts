import { createId, toJson, type ControlTriggerDispatchRow, type Env } from "./types";

const maximumRecoveryBatch = 25;

type ExpiredDispatch = Pick<
  ControlTriggerDispatchRow,
  | "id"
  | "trigger_id"
  | "user_id"
  | "workspace_id"
  | "agent_id"
  | "run_id"
  | "status"
  | "lease_expires_at"
> & { workflow_intent_id: string | null };

export const recoverExpiredTriggerDispatches = async (
  env: Env,
  input: { now?: Date; limit?: number } = {},
) => {
  const timestamp = (input.now ?? new Date()).toISOString();
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? maximumRecoveryBatch), 1), 100);
  const expired = await env.DB.prepare(
    `SELECT d.id, d.trigger_id, d.user_id, d.workspace_id, d.agent_id, d.run_id,
            d.status, d.lease_expires_at, r.workflow_intent_id
     FROM control_trigger_dispatches d
     LEFT JOIN control_runs r
       ON r.user_id = d.user_id
      AND r.workspace_id = d.workspace_id
      AND r.id = d.run_id
     WHERE d.status IN ('leased', 'running')
       AND d.lease_expires_at IS NOT NULL
       AND d.lease_expires_at <= ?
     ORDER BY d.lease_expires_at ASC
     LIMIT ?`,
  )
    .bind(timestamp, limit)
    .all<ExpiredDispatch>();

  let recovered = 0;
  for (const dispatch of expired.results) {
    const error = { code: "lease_expired", message: "Trigger dispatch lease expired." };
    const statements = [];
    if (dispatch.run_id) {
      statements.push(
        env.DB.prepare(
          `UPDATE control_runs
           SET status = 'failed', last_event_at = ?, failed_at = ?, data_json = ?, updated_at = ?
           WHERE user_id = ? AND workspace_id = ? AND id = ?
             AND status IN ('queued', 'running', 'waiting', 'interrupted')`,
        ).bind(
          timestamp,
          timestamp,
          toJson({ summary: error.message, errorCode: error.code, triggerDispatchId: dispatch.id }),
          timestamp,
          dispatch.user_id,
          dispatch.workspace_id,
          dispatch.run_id,
        ),
      );
      if (dispatch.workflow_intent_id) {
        statements.push(
          env.DB.prepare(
            `UPDATE control_workflow_intents
             SET status = 'failed', updated_at = ?
             WHERE user_id = ? AND workspace_id = ? AND id = ?
               AND status IN ('queued', 'running', 'waiting', 'interrupted')
               AND EXISTS (
                 SELECT 1 FROM control_runs
                 WHERE user_id = ? AND workspace_id = ? AND id = ?
                   AND status = 'failed' AND updated_at = ?
               )`,
          ).bind(
            timestamp,
            dispatch.user_id,
            dispatch.workspace_id,
            dispatch.workflow_intent_id,
            dispatch.user_id,
            dispatch.workspace_id,
            dispatch.run_id,
            timestamp,
          ),
        );
      }
    }
    statements.push(
      env.DB.prepare(
        `UPDATE control_trigger_dispatches
         SET status = 'failed', lease_owner = NULL, lease_expires_at = NULL,
             error_json = ?, updated_at = ?
         WHERE user_id = ? AND workspace_id = ? AND id = ?
           AND status IN ('leased', 'running')
           AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?`,
      ).bind(
        toJson(error),
        timestamp,
        dispatch.user_id,
        dispatch.workspace_id,
        dispatch.id,
        timestamp,
      ),
      env.DB.prepare(
        `INSERT INTO control_audit_events (
           id, user_id, workspace_id, action, summary, target_type, target_id,
           data_json, created_at
         ) SELECT ?, ?, ?, 'trigger.dispatch.failed', ?, 'triggerDispatch', ?, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM control_trigger_dispatches
           WHERE user_id = ? AND workspace_id = ? AND id = ?
             AND status = 'failed' AND updated_at = ?
         )`,
      ).bind(
        createId("cf-audit"),
        dispatch.user_id,
        dispatch.workspace_id,
        error.message,
        dispatch.id,
        toJson({ triggerId: dispatch.trigger_id, runId: dispatch.run_id, errorCode: error.code }),
        timestamp,
        dispatch.user_id,
        dispatch.workspace_id,
        dispatch.id,
        timestamp,
      ),
      env.DB.prepare(
        `INSERT INTO control_plane_events (
           id, user_id, workspace_id, agent_id, type, summary, target_type, target_id,
           data_json, created_at
         ) SELECT ?, ?, ?, ?, 'trigger.dispatch.failed', ?, 'triggerDispatch', ?, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM control_trigger_dispatches
           WHERE user_id = ? AND workspace_id = ? AND id = ?
             AND status = 'failed' AND updated_at = ?
         )`,
      ).bind(
        createId("cf-event"),
        dispatch.user_id,
        dispatch.workspace_id,
        dispatch.agent_id,
        error.message,
        dispatch.id,
        toJson({ triggerId: dispatch.trigger_id, runId: dispatch.run_id, errorCode: error.code }),
        timestamp,
        dispatch.user_id,
        dispatch.workspace_id,
        dispatch.id,
        timestamp,
      ),
    );

    const results = await env.DB.batch(statements);
    const dispatchUpdateIndex = statements.length - 3;
    if (results[dispatchUpdateIndex]?.meta?.changes) recovered += 1;
  }

  return { inspected: expired.results.length, recovered };
};
