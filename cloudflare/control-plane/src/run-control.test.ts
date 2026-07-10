import { describe, expect, it } from "vitest";

import { handleCancelExecutionRun, handleRetryExecutionRun } from "./run-control";
import type {
  AgentIdentity,
  ControlRunRow,
  D1PreparedStatement,
  D1Result,
  Env,
  MembershipRow,
} from "./types";

const timestamp = "2026-07-09T00:00:00.000Z";
const identity = {
  scope: { userId: "user-1", workspaceId: "workspace-1" },
  agentId: "agent-1",
} satisfies AgentIdentity;

const membership: MembershipRow = {
  id: "membership-1",
  user_id: identity.scope.userId,
  workspace_id: identity.scope.workspaceId,
  role: "member",
  status: "active",
  roles_json: '["member"]',
  permissions_json: "[]",
  data_json: "{}",
  created_at: timestamp,
  updated_at: timestamp,
};

const runRow = (
  status: ControlRunRow["status"],
): ControlRunRow & {
  workflow_type: string;
  payload_json: string;
} => ({
  id: "run-1",
  user_id: identity.scope.userId,
  workspace_id: identity.scope.workspaceId,
  agent_id: identity.agentId,
  workflow_intent_id: "intent-1",
  status,
  execution_json: '{"mode":"dry_run"}',
  stage: "analyze",
  engine: "langgraph-declared",
  heartbeat_at: timestamp,
  last_event_at: timestamp,
  completed_at: null,
  failed_at: null,
  data_json: '{"displayName":"Research"}',
  created_at: timestamp,
  updated_at: timestamp,
  workflow_type: "polymancer.market_research",
  payload_json: '{"input":{"query":"rates"}}',
});

const makeEnv = (status: ControlRunRow["status"], cancelChanges = 1) => {
  const statements: Array<{ query: string; values: unknown[] }> = [];
  const makeStatement = (query: string): D1PreparedStatement => {
    const call = { query, values: [] as unknown[] };
    return {
      bind(...values: unknown[]) {
        call.values = values;
        return this;
      },
      async first<T>() {
        if (query.includes("FROM memberships")) return membership as T;
        if (query.includes("FROM control_runs r")) return runRow(status) as T;
        return null;
      },
      async all<T>() {
        return { results: [] as T[] };
      },
      async run() {
        statements.push(call);
        return {
          success: true,
          meta: {
            changes: query.includes("UPDATE control_runs") ? cancelChanges : 1,
          },
        };
      },
    };
  };
  const env = {
    DB: {
      prepare: makeStatement,
      async batch(batchStatements: D1PreparedStatement[]) {
        for (const statement of batchStatements) await statement.run();
        return batchStatements.map(() => ({ success: true })) as D1Result[];
      },
    },
  } satisfies Partial<Env>;
  return { env: env as Env, statements };
};

describe("run control", () => {
  it("cancels an active scoped run and its active tool calls", async () => {
    const { env, statements } = makeEnv("running");
    const response = await handleCancelExecutionRun(env, identity, "run-1");
    const body = (await response.json()) as { ok?: boolean; run?: { status?: string } };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, run: { status: "cancelled" } });
    expect(
      statements.some(
        (statement) =>
          statement.query.includes("UPDATE control_runs") &&
          statement.values.includes("run-1") &&
          JSON.stringify(statement.values).includes("Cancelled by the user"),
      ),
    ).toBe(true);
    expect(
      statements.some((statement) => statement.query.includes("UPDATE control_tool_calls")),
    ).toBe(true);
  });

  it("rejects cancellation after a run is terminal", async () => {
    const { env, statements } = makeEnv("completed");
    const response = await handleCancelExecutionRun(env, identity, "run-1");

    expect(response.status).toBe(409);
    expect(statements).toEqual([]);
  });

  it("does not overwrite a run that became terminal during cancellation", async () => {
    const { env, statements } = makeEnv("running", 0);
    const response = await handleCancelExecutionRun(env, identity, "run-1");

    expect(response.status).toBe(409);
    expect(
      statements.some((statement) => statement.query.includes("UPDATE control_workflow_intents")),
    ).toBe(false);
  });

  it("retries a supported workflow from its stored typed input", async () => {
    const { env, statements } = makeEnv("failed");
    let receivedBody: unknown;
    let receivedAgentId: string | undefined;
    const response = await handleRetryExecutionRun(
      new Request("https://worker.test/workbench/history/runs/run-1/retry", { method: "POST" }),
      env,
      identity,
      "run-1",
      {
        "polymancer.market_research": async (request, _env, retryIdentity) => {
          receivedBody = await request.json();
          receivedAgentId = retryIdentity.agentId;
          return Response.json({
            ok: true,
            run: { runId: "run-2", workflowIntentId: "intent-2", status: "completed" },
          });
        },
        "swordfish.runtime_research": async () => Response.json({ ok: false }, { status: 500 }),
      },
    );

    expect(response.status).toBe(200);
    expect(receivedBody).toEqual({ input: { query: "rates" }, executionMode: "dry_run" });
    expect(receivedAgentId).toBe("agent-1");
    expect(
      statements.some(
        (statement) =>
          statement.query.includes("json_set") &&
          statement.values[0] === "run-1" &&
          statement.values.includes("run-2"),
      ),
    ).toBe(true);
  });
});
