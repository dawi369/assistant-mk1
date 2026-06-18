import { describe, expect, it } from "vitest";

import { listArtifactHistory, listExecutionHistory, readHistoryLimit } from "./workbench-history";
import type { AgentIdentity, D1PreparedStatement, Env } from "./types";

const identity: AgentIdentity = {
  scope: {
    userId: "user-1",
    workspaceId: "workspace-1",
  },
  agentId: "agent-1",
};

const makeUrl = (query = "") => new URL(`https://worker.test/workbench/history/runs${query}`);

const jsonOf = async <T>(response: Response) => (await response.json()) as T;

const makeEnv = (results: unknown[]) => {
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
            return (results[0] ?? null) as T | null;
          },
          async all<T>() {
            return { results: results as T[] };
          },
          async run() {
            return { success: true };
          },
        };
      },
      async batch() {
        return [];
      },
    },
  } satisfies Pick<Env, "DB">;

  return { env: env as Env, calls };
};

describe("workbench history", () => {
  it("clamps history limits", () => {
    expect(readHistoryLimit(makeUrl())).toBe(25);
    expect(readHistoryLimit(makeUrl("?limit=0"))).toBe(1);
    expect(readHistoryLimit(makeUrl("?limit=7.9"))).toBe(7);
    expect(readHistoryLimit(makeUrl("?limit=500"))).toBe(100);
    expect(readHistoryLimit(makeUrl("?limit=not-a-number"))).toBe(25);
  });

  it("lists scoped execution history as compact run summaries", async () => {
    const { env, calls } = makeEnv([
      {
        id: "run-1",
        user_id: "user-1",
        workspace_id: "workspace-1",
        agent_id: "agent-1",
        workflow_intent_id: "intent-1",
        status: "completed",
        execution_json: "{}",
        stage: "observe",
        engine: "cloudflare",
        heartbeat_at: "2026-06-18T10:00:00.000Z",
        last_event_at: "2026-06-18T10:01:00.000Z",
        completed_at: "2026-06-18T10:02:00.000Z",
        failed_at: null,
        data_json: JSON.stringify({
          summary: "Finished",
          displayName: "Demo run",
          artifactIds: ["artifact-1", 42],
          decisionIds: ["decision-1", null],
        }),
        created_at: "2026-06-18T09:59:00.000Z",
        updated_at: "2026-06-18T10:02:00.000Z",
        tool_call_count: 2,
      },
    ]);

    const response = await listExecutionHistory(env, identity, makeUrl("?limit=5"));
    const body = await jsonOf<{
      ok?: boolean;
      runs?: Array<{
        id?: string;
        scope?: { userId?: string; workspaceId?: string };
        summary?: string;
        artifactIds?: string[];
        decisionIds?: string[];
        toolCallCount?: number;
      }>;
      limit?: number;
    }>(response);

    expect(body.ok).toBe(true);
    expect(body.limit).toBe(5);
    expect(body.runs?.[0]).toMatchObject({
      id: "run-1",
      scope: { userId: "user-1", workspaceId: "workspace-1" },
      summary: "Finished",
      artifactIds: ["artifact-1"],
      decisionIds: ["decision-1"],
      toolCallCount: 2,
    });
    expect(calls[0]?.values).toEqual(["user-1", "workspace-1", 5]);
  });

  it("lists scoped artifact metadata without blob payloads", async () => {
    const { env, calls } = makeEnv([
      {
        id: "artifact-1",
        user_id: "user-1",
        workspace_id: "workspace-1",
        kind: "report",
        uri: "d1://control-plane/run-1/report.json",
        title: "Report",
        mime_type: "application/json",
        size_bytes: 256,
        data_json: JSON.stringify({ source: "callback" }),
        created_at: "2026-06-18T10:00:00.000Z",
      },
    ]);

    const response = await listArtifactHistory(env, identity, makeUrl("?limit=3"));
    const body = await jsonOf<{
      ok?: boolean;
      artifacts?: Array<{
        id?: string;
        uri?: string;
        data?: Record<string, unknown>;
      }>;
      limit?: number;
    }>(response);

    expect(body.ok).toBe(true);
    expect(body.limit).toBe(3);
    expect(body.artifacts?.[0]).toMatchObject({
      id: "artifact-1",
      uri: "d1://control-plane/run-1/report.json",
      data: { source: "callback" },
    });
    expect(calls[0]?.values).toEqual(["user-1", "workspace-1", 3]);
  });
});
