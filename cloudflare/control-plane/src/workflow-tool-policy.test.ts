import { describe, expect, it } from "vitest";

import { authorizeWorkflowTools } from "./workflow-tool-policy";
import type { AgentIdentity, D1PreparedStatement, Env } from "./types";

const identity: AgentIdentity = {
  scope: { userId: "user-1", workspaceId: "workspace-1" },
  agentId: "agent-1",
};

describe("workflow tool policy", () => {
  it("blocks a disabled workflow-internal tool and records the policy decision", async () => {
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
              if (query.includes("FROM memberships")) {
                return {
                  id: "membership-1",
                  user_id: "user-1",
                  workspace_id: "workspace-1",
                  role: "member",
                  status: "active",
                  roles_json: "[]",
                  permissions_json: "[]",
                  data_json: "{}",
                  created_at: "2026-07-12T00:00:00.000Z",
                  updated_at: "2026-07-12T00:00:00.000Z",
                } as T;
              }
              if (query.includes("FROM tool_permissions")) {
                return {
                  id: "permission-1",
                  user_id: "user-1",
                  workspace_id: "workspace-1",
                  agent_id: "agent-1",
                  tool_id: "repo.snapshot",
                  status: "disabled",
                  execution_json:
                    '{"mode":"dry_run","policy":"repo-snapshot-readonly-v0","allowedExecutionModes":["dry_run"]}',
                  data_json: '{"killSwitchReason":"Disabled for maintenance."}',
                  created_at: "2026-07-12T00:00:00.000Z",
                  updated_at: "2026-07-12T00:00:00.000Z",
                } as T;
              }
              return null;
            },
            async all<T>() {
              return { results: [] as T[] };
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
    } as Env;

    const result = await authorizeWorkflowTools(env, identity, {
      toolNames: ["repo.snapshot"],
      executionMode: "dry_run",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(403);
      await expect(result.response.json()).resolves.toMatchObject({
        details: { code: "tool_disabled" },
      });
    }
    expect(calls.some((call) => call.query.includes("INSERT INTO control_policy_decisions"))).toBe(
      true,
    );
    expect(calls.some((call) => call.query.includes("INSERT INTO control_audit_events"))).toBe(
      true,
    );
  });
});
