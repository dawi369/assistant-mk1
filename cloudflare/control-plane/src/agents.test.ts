import { describe, expect, it } from "vitest";

import { handleActivateAgent, handleCreateAgent } from "./agents";
import type {
  AgentIdentity,
  AgentRow,
  D1PreparedStatement,
  D1Result,
  Env,
  MembershipRow,
} from "./types";

type RecordedStatement = {
  query: string;
  values: unknown[];
};

const timestamp = "2026-06-23T00:00:00.000Z";

const identity = {
  agentId: "agent-current",
  scope: {
    userId: "user-1",
    workspaceId: "workspace-1",
  },
  accountId: "account-1",
  accountSource: "test",
} satisfies AgentIdentity;

const membershipRow = (role: string): MembershipRow => ({
  id: `membership-${role}`,
  user_id: identity.scope.userId,
  workspace_id: identity.scope.workspaceId,
  role,
  status: "active",
  roles_json: JSON.stringify([role]),
  permissions_json: JSON.stringify([]),
  data_json: "{}",
  created_at: timestamp,
  updated_at: timestamp,
});

const agentRow = (input?: { status?: string }): AgentRow => ({
  id: "agent-swordfish",
  workspace_id: identity.scope.workspaceId,
  name: "Baby Swordfish",
  description: "Public Swordfish runtime research.",
  status: input?.status ?? "active",
  is_default: 0,
  created_by_user_id: identity.scope.userId,
  data_json: JSON.stringify({ profile: "analyst" }),
  created_at: timestamp,
  updated_at: timestamp,
});

const createRecordingEnv = (input: { role: string; agent?: AgentRow | null }) => {
  const statements: RecordedStatement[] = [];
  const membership = membershipRow(input.role);

  const createStatement = (query: string): D1PreparedStatement & RecordedStatement => {
    const statement = {
      query,
      values: [] as unknown[],
      bind(...values: unknown[]) {
        statement.values = values;
        return statement;
      },
      async first<T = unknown>() {
        if (query.includes("FROM memberships")) return membership as T;
        if (query.includes("FROM agents")) return (input.agent ?? null) as T | null;
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

describe("agents", () => {
  it("keeps agent creation admin-only", async () => {
    const { env, statements } = createRecordingEnv({ role: "member", agent: agentRow() });
    const request = new Request("https://worker.test/agents", {
      method: "POST",
      body: JSON.stringify({
        name: "Baby Swordfish",
        profile: "analyst",
        behaviorTemplateId: "pack-baby-swordfish",
        activate: true,
      }),
    });

    const response = await handleCreateAgent(request, env, identity);
    const body = (await response.json()) as { ok?: boolean; error?: string };

    expect(response.status).toBe(403);
    expect(body.ok).toBe(false);
    expect(body.error).toBe("Workspace admin role is required");
    expect(statements.some((statement) => statement.query.includes("INSERT INTO agents"))).toBe(
      false,
    );
  });

  it("allows active workspace members to activate existing active agents", async () => {
    const { env, statements } = createRecordingEnv({ role: "member", agent: agentRow() });

    const response = await handleActivateAgent(env, identity, "agent-swordfish");
    const body = (await response.json()) as { ok?: boolean; activeAgentId?: string };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.activeAgentId).toBe("agent-swordfish");
    expect(
      statements.some(
        (statement) =>
          statement.query.includes("INSERT INTO active_agent_preferences") &&
          statement.values.includes("agent-swordfish") &&
          JSON.stringify(statement.values).includes("agent-activated"),
      ),
    ).toBe(true);
  });
});
