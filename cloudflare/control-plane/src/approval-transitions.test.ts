import { describe, expect, it } from "vitest";

import { approveApprovalAndResumeRun, denyApprovalAndCancelRun } from "./admin-tools";
import type {
  AgentIdentity,
  ControlApprovalRequestRow,
  D1PreparedStatement,
  D1Result,
  Env,
} from "./types";

const identity = {
  scope: { userId: "user-1", workspaceId: "workspace-1" },
  agentId: "agent-1",
} satisfies AgentIdentity;

const approval: ControlApprovalRequestRow = {
  id: "approval-1",
  user_id: "user-1",
  workspace_id: "workspace-1",
  agent_id: "agent-1",
  workflow_intent_id: "intent-1",
  run_id: "run-1",
  tool_id: "url.inspect",
  status: "requested",
  reason: "Confirm inspection",
  data_json: "{}",
  created_at: "2026-07-11T00:00:00.000Z",
  updated_at: "2026-07-11T00:00:00.000Z",
};

const makeEnv = (runChanges: number) => {
  const queries: string[] = [];
  const env = {
    DB: {
      prepare(query: string) {
        queries.push(query);
        const statement: D1PreparedStatement & { query: string } = {
          query,
          bind() {
            return statement;
          },
          async first<T>() {
            return null as T | null;
          },
          async all<T>() {
            return { results: [] as T[] };
          },
          async run() {
            return { success: true };
          },
        };
        return statement;
      },
      async batch(statements: Array<D1PreparedStatement & { query?: string }>) {
        return statements.map((statement) => ({
          success: true,
          meta: { changes: statement.query?.includes("UPDATE control_runs") ? runChanges : 1 },
        })) as D1Result[];
      },
    },
  } satisfies Partial<Env>;
  return { env: env as Env, queries };
};

describe("approval run transitions", () => {
  it("does not approve an interrupted request after its run becomes terminal", async () => {
    const { env, queries } = makeEnv(0);
    await expect(approveApprovalAndResumeRun(env, identity, approval, "policy-1")).resolves.toBe(
      false,
    );
    expect(queries.find((query) => query.includes("UPDATE control_runs"))).toContain(
      "status = 'interrupted'",
    );
    expect(
      queries
        .filter((query) => /control_audit_events|control_plane_events/.test(query))
        .every((query) => query.includes("updated_at = ?")),
    ).toBe(true);
  });

  it("does not let a denial overwrite a run that is already terminal", async () => {
    const { env, queries } = makeEnv(0);
    await expect(
      denyApprovalAndCancelRun(env, identity, approval, "Denied after cancellation"),
    ).resolves.toBe(false);
    expect(queries.find((query) => query.includes("UPDATE control_runs"))).toContain(
      "status = 'interrupted'",
    );
    expect(
      queries
        .filter((query) => /control_audit_events|control_plane_events/.test(query))
        .every((query) => query.includes("updated_at = ?")),
    ).toBe(true);
  });
});
