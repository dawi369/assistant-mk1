import { describe, expect, it } from "vitest";

import {
  createAllowedChatRunBoundary,
  isChatRunClaimConflict,
  updateChatRun,
} from "./chat-boundary-store";
import type { AgentIdentity, D1PreparedStatement, D1Result, Env } from "./types";

const identity = {
  scope: { userId: "user-1", workspaceId: "workspace-1" },
  agentId: "agent-1",
} satisfies AgentIdentity;

const makeEnv = () => {
  const statements: Array<{ query: string; values: unknown[] }> = [];
  const prepare = (query: string): D1PreparedStatement => {
    const statement = { query, values: [] as unknown[] };
    return {
      bind(...values: unknown[]) {
        statement.values = values;
        return this;
      },
      async first<T>() {
        return null as T | null;
      },
      async all<T>() {
        return { results: [] as T[] };
      },
      async run() {
        statements.push(statement);
        return {
          success: true,
          meta: { changes: 1 },
        } satisfies D1Result;
      },
    };
  };
  const env = {
    DB: {
      prepare,
      async batch(batchStatements: D1PreparedStatement[]) {
        return Promise.all(batchStatements.map((statement) => statement.run())) as Promise<
          D1Result[]
        >;
      },
    },
  } satisfies Partial<Env>;
  return { env: env as Env, statements };
};

describe("chat run claims", () => {
  it("atomically stores the allowed intent, policy, and running claim", async () => {
    const { env, statements } = makeEnv();
    const boundary = await createAllowedChatRunBoundary(env, identity, {
      sessionId: "session-1",
      threadId: "thread-1",
      executionMode: "ask",
      payload: { messageCount: 1 },
      reason: "Chat ask mode is allowed by dev policy",
      limits: { sameThreadConcurrency: 1 },
    });

    expect(boundary.runId).toMatch(/^cf-chat-run-/);
    expect(statements).toHaveLength(3);
    expect(statements[0]?.query).toContain("INSERT INTO chat_intents");
    expect(statements[1]?.query).toContain("INSERT INTO chat_policy_decisions");
    expect(statements[2]?.query).toContain("INSERT INTO chat_runs");
    expect(statements[2]?.values).toContain(boundary.intentId);
    expect(statements[2]?.values).toContain(boundary.policyDecisionId);
  });

  it("recognizes only the running-slot uniqueness failure as a claim conflict", () => {
    expect(
      isChatRunClaimConflict(
        new Error(
          "D1_ERROR: UNIQUE constraint failed: chat_runs.user_id, chat_runs.workspace_id, chat_runs.thread_id",
        ),
      ),
    ).toBe(true);
    expect(isChatRunClaimConflict(new Error("D1_ERROR: database unavailable"))).toBe(false);
  });

  it("only permits terminal publication while the chat run is still running", async () => {
    const { env, statements } = makeEnv();
    const result = await updateChatRun(env, {
      runId: "run-1",
      scope: identity.scope,
      status: "completed",
      metadata: { outputChars: 12 },
    });

    expect(result).toEqual({ updated: true });
    expect(statements).toHaveLength(1);
    expect(statements[0]?.query).toContain("AND status = 'running'");
    expect(statements[0]?.values).toContain("completed");
  });
});
