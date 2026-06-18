import { describe, expect, it } from "vitest";

import { handleExternalSignal } from "./external-signals";
import type { D1PreparedStatement, D1Result, Env } from "./types";

type RecordedStatement = {
  query: string;
  values: unknown[];
};

const createRecordingEnv = () => {
  const statements: RecordedStatement[] = [];
  const createStatement = (query: string): D1PreparedStatement & RecordedStatement => {
    const statement = {
      query,
      values: [] as unknown[],
      bind(...values: unknown[]) {
        statement.values = values;
        return statement;
      },
      async first<T = unknown>() {
        return null as T | null;
      },
      async all<T = unknown>() {
        return { results: [] as T[] };
      },
      async run() {
        statements.push({ query, values: statement.values });
        return { success: true };
      },
    };
    return statement;
  };

  const env = {
    DB: {
      prepare: createStatement,
      async batch(batchStatements: Array<D1PreparedStatement & Partial<RecordedStatement>>) {
        for (const statement of batchStatements) {
          statements.push({
            query: statement.query ?? "unknown",
            values: statement.values ?? [],
          });
        }
        return batchStatements.map(() => ({ success: true })) as D1Result[];
      },
    },
  } satisfies Partial<Env>;

  return { env: env as Env, statements };
};

describe("Cloudflare external signals", () => {
  it("records intent, run, audit, and event before LangGraph delegation", async () => {
    const { env, statements } = createRecordingEnv();
    const response = await handleExternalSignal(
      new Request("https://worker.test/external-signals", {
        method: "POST",
        body: JSON.stringify({ action: "start", input: { task: "snapshot" } }),
      }),
      env,
      {
        scope: { userId: "user-1", workspaceId: "workspace-1" },
        agentId: "agent-1",
        accountId: "acct-1",
        accountSource: "workos-personal",
      },
    );

    expect(response.status).toBe(500);
    const body = (await response.json()) as {
      controlPlane?: { runId?: string; workflowIntentId?: string; intentId?: string };
    };
    expect(body.controlPlane?.runId).toMatch(/^cf-run-/);
    expect(body.controlPlane?.intentId).toBe(body.controlPlane?.workflowIntentId);

    const firstQueries = statements.slice(0, 4).map((statement) => statement.query);
    expect(firstQueries[0]).toContain("INSERT INTO control_workflow_intents");
    expect(firstQueries[1]).toContain("INSERT INTO control_runs");
    expect(firstQueries[2]).toContain("INSERT INTO control_audit_events");
    expect(firstQueries[3]).toContain("INSERT INTO control_plane_events");
  });
});
