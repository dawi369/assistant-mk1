import { describe, expect, it } from "vitest";

import { recoverExpiredTriggerDispatches } from "./trigger-recovery";
import type { D1PreparedStatement, D1Result, Env } from "./types";

describe("trigger lease recovery", () => {
  it("fails an expired dispatch and its still-active canonical run atomically", async () => {
    const statements: Array<{ query: string; values: unknown[] }> = [];
    const expired = {
      id: "dispatch-1",
      trigger_id: "trigger-1",
      user_id: "user-1",
      workspace_id: "workspace-1",
      agent_id: "agent-1",
      run_id: "run-1",
      workflow_intent_id: "intent-1",
      status: "running",
      lease_expires_at: "2026-07-12T00:00:00.000Z",
    };
    const env = {
      DB: {
        prepare(query: string): D1PreparedStatement & { query: string; values: unknown[] } {
          const statement = {
            query,
            values: [] as unknown[],
            bind(...values: unknown[]) {
              statement.values = values;
              return statement;
            },
            async first<T>() {
              return null as T | null;
            },
            async all<T>() {
              return { results: [expired] as T[] };
            },
            async run() {
              return { success: true };
            },
          };
          return statement;
        },
        async batch(batch: Array<D1PreparedStatement & { query?: string; values?: unknown[] }>) {
          statements.push(
            ...batch.map((statement) => ({
              query: statement.query ?? "",
              values: statement.values ?? [],
            })),
          );
          return batch.map(() => ({ success: true, meta: { changes: 1 } })) as D1Result[];
        },
      },
    } as Env;

    const result = await recoverExpiredTriggerDispatches(env, {
      now: new Date("2026-07-12T00:01:00.000Z"),
    });

    expect(result).toEqual({ inspected: 1, recovered: 1 });
    expect(statements.map((statement) => statement.query)).toEqual([
      expect.stringContaining("UPDATE control_runs"),
      expect.stringContaining("UPDATE control_workflow_intents"),
      expect.stringContaining("UPDATE control_trigger_dispatches"),
      expect.stringContaining("INSERT INTO control_audit_events"),
      expect.stringContaining("INSERT INTO control_plane_events"),
    ]);
    expect(statements[2]?.query).toContain("lease_expires_at <= ?");
    expect(statements[2]?.values).toContain("dispatch-1");
  });
});
