import { beforeAll, describe, expect, it } from "vitest";

import { sha256Hex } from "../../../lib/workbench/control-plane-signing";
import { handleTriggerWebhookIngress, triggerSecretHeader } from "./trigger-webhook";
import type {
  ControlTriggerDispatchRow,
  ControlTriggerRow,
  D1PreparedStatement,
  D1Result,
  Env,
} from "./types";

const secret = "webhook-secret-with-enough-entropy-for-test";
let secretHash = "";

beforeAll(async () => {
  secretHash = await sha256Hex(secret);
});

const trigger = (): ControlTriggerRow => ({
  id: "trigger-webhook-1",
  public_id: "hook-12345678-abcd",
  secret_hash: secretHash,
  user_id: "user-1",
  workspace_id: "workspace-1",
  agent_id: "agent-1",
  pack_id: "repo-analyst",
  pack_trigger_id: "readiness-requested",
  kind: "webhook",
  workflow_type: "repo.readiness_report",
  status: "enabled",
  execution_json: '{"mode":"dry_run"}',
  config_json: '{"eventType":"repository.readiness_requested"}',
  input_json: '{"includeDocs":true}',
  max_concurrent_runs: 1,
  version: 1,
  next_trigger_at: null,
  last_triggered_at: null,
  created_by_user_id: "user-1",
  created_at: "2026-07-12T00:00:00.000Z",
  updated_at: "2026-07-12T00:00:00.000Z",
});

const dispatch = (): ControlTriggerDispatchRow => ({
  id: "dispatch-webhook-1",
  trigger_id: "trigger-webhook-1",
  user_id: "user-1",
  workspace_id: "workspace-1",
  agent_id: "agent-1",
  idempotency_key: "delivery-1",
  source: "webhook",
  status: "pending",
  attempt_count: 0,
  run_id: null,
  previous_run_id: null,
  scheduled_for: null,
  received_at: "2026-07-12T00:01:00.000Z",
  lease_owner: null,
  lease_expires_at: null,
  heartbeat_at: null,
  payload_json: "{}",
  error_json: "{}",
  created_at: "2026-07-12T00:01:00.000Z",
  updated_at: "2026-07-12T00:01:00.000Z",
});

const makeEnv = (changes = 1) => {
  const calls: Array<{ query: string; values: unknown[] }> = [];
  const env = {
    DB: {
      prepare(query: string): D1PreparedStatement {
        const call = { query, values: [] as unknown[] };
        calls.push(call);
        return {
          bind(...values: unknown[]) {
            call.values = values;
            return this;
          },
          async first<T>() {
            if (query.includes("FROM control_triggers")) return trigger() as T;
            if (query.includes("FROM control_trigger_dispatches")) return dispatch() as T;
            return null;
          },
          async all<T>() {
            return { results: [] as T[] };
          },
          async run() {
            return { success: true, meta: { changes } };
          },
        };
      },
      async batch(statements: D1PreparedStatement[]) {
        return statements.map(() => ({ success: true, meta: { changes } })) as D1Result[];
      },
    },
  } satisfies Pick<Env, "DB">;
  return { env: env as Env, calls };
};

const request = (providedSecret = secret) =>
  new Request("https://worker.test/trigger-ingress/hook-12345678-abcd", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": "delivery-1",
      [triggerSecretHeader]: providedSecret,
    },
    body: JSON.stringify({ includeConfig: true }),
  });

describe("trigger webhook ingress", () => {
  it("accepts and normalizes one authenticated idempotent delivery", async () => {
    const { env, calls } = makeEnv();
    const response = await handleTriggerWebhookIngress(request(), env, "hook-12345678-abcd");

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      duplicate: false,
      dispatchId: "dispatch-webhook-1",
    });
    const insert = calls.find((call) =>
      call.query.includes("INSERT OR IGNORE INTO control_trigger_dispatches"),
    );
    expect(insert?.values).toContain("delivery-1");
    expect(insert?.values).not.toContain(secret);
  });

  it("returns the existing dispatch for a duplicate delivery", async () => {
    const { env } = makeEnv(0);
    const response = await handleTriggerWebhookIngress(request(), env, "hook-12345678-abcd");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ duplicate: true });
  });

  it("rejects an invalid per-trigger secret before persistence", async () => {
    const { env, calls } = makeEnv();
    const response = await handleTriggerWebhookIngress(
      request("wrong-secret"),
      env,
      "hook-12345678-abcd",
    );
    expect(response.status).toBe(401);
    expect(calls.some((call) => call.query.includes("INSERT OR IGNORE"))).toBe(false);
  });
});
