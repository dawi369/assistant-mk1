import { describe, expect, it } from "vitest";

import { handleAddWorkspaceMember, handleListWorkspaceMembers } from "./workspace-members";
import type { AgentIdentity, D1PreparedStatement, Env, MembershipRow, WorkspaceRow } from "./types";

const timestamp = "2026-07-09T00:00:00.000Z";
const identity = {
  scope: { userId: "owner-1", workspaceId: "workspace-account-1-team" },
  agentId: "agent-1",
  accountId: "account-1",
  accountSource: "workos-organization",
} satisfies AgentIdentity;

const workspace = (id: string, isDefault = false): WorkspaceRow => ({
  id,
  account_id: "account-1",
  account_source: "workos-organization",
  name: isDefault ? "Default" : "Team",
  status: "active",
  is_default: isDefault ? 1 : 0,
  created_by_user_id: identity.scope.userId,
  data_json: "{}",
  created_at: timestamp,
  updated_at: timestamp,
});

const membership = (userId: string, workspaceId: string, role: string): MembershipRow => ({
  id: `membership-${userId}-${workspaceId}`,
  user_id: userId,
  workspace_id: workspaceId,
  role,
  status: "active",
  roles_json: JSON.stringify([role]),
  permissions_json: "[]",
  data_json: "{}",
  created_at: timestamp,
  updated_at: timestamp,
});

const makeEnv = (input: {
  targetHasAccountMembership: boolean;
  targetUserStatus?: "active" | "disabled";
}) => {
  const writes: Array<{ query: string; values: unknown[] }> = [];
  const makeStatement = (query: string): D1PreparedStatement => {
    const call = { query, values: [] as unknown[] };
    return {
      bind(...values: unknown[]) {
        call.values = values;
        return this;
      },
      async first<T>() {
        if (query.includes("FROM workspaces") && query.includes("WHERE id = ?")) {
          return workspace(String(call.values[0])) as T;
        }
        if (query.includes("FROM workspaces") && query.includes("is_default = 1")) {
          return workspace("workspace-account-1-default", true) as T;
        }
        if (query.includes("FROM users")) {
          return {
            id: String(call.values[0]),
            status: input.targetUserStatus ?? "active",
          } as T;
        }
        if (query.includes("FROM memberships")) {
          const [userId, workspaceId] = call.values.map(String);
          if (userId === identity.scope.userId && workspaceId === identity.scope.workspaceId) {
            return membership(userId, workspaceId, "owner") as T;
          }
          if (
            input.targetHasAccountMembership &&
            userId === "target-1" &&
            workspaceId === "workspace-account-1-default"
          ) {
            return membership(userId, workspaceId, "member") as T;
          }
          return null;
        }
        return null;
      },
      async all<T>() {
        return { results: [] as T[] };
      },
      async run() {
        writes.push(call);
        return { success: true };
      },
    };
  };
  const env = {
    DB: {
      prepare: makeStatement,
      async batch() {
        return [];
      },
    },
  } satisfies Partial<Env>;
  return { env: env as Env, writes };
};

describe("workspace members", () => {
  it("hides member data for a workspace outside the active scope", async () => {
    const { env, writes } = makeEnv({ targetHasAccountMembership: true });
    const response = await handleListWorkspaceMembers(env, identity, "workspace-account-2-team");

    expect(response.status).toBe(404);
    expect(writes).toEqual([]);
  });

  it("rejects adding a user without an active account membership", async () => {
    const { env, writes } = makeEnv({ targetHasAccountMembership: false });
    const request = new Request("https://worker.test/workspaces/current/members", {
      method: "POST",
      body: JSON.stringify({ userId: "target-1", role: "member" }),
    });
    const response = await handleAddWorkspaceMember(
      request,
      env,
      identity,
      identity.scope.workspaceId,
    );

    expect(response.status).toBe(404);
    expect(writes.some((write) => write.query.includes("INSERT INTO memberships"))).toBe(false);
  });

  it("adds a verified account member to the active workspace", async () => {
    const { env, writes } = makeEnv({ targetHasAccountMembership: true });
    const request = new Request("https://worker.test/workspaces/current/members", {
      method: "POST",
      body: JSON.stringify({ userId: "target-1", role: "member" }),
    });
    const response = await handleAddWorkspaceMember(
      request,
      env,
      identity,
      identity.scope.workspaceId,
    );

    expect(response.status).toBe(201);
    expect(
      writes.some(
        (write) =>
          write.query.includes("INSERT INTO memberships") &&
          write.values.includes("target-1") &&
          write.values.includes(identity.scope.workspaceId),
      ),
    ).toBe(true);
  });

  it("rejects adding a globally disabled account member", async () => {
    const { env, writes } = makeEnv({
      targetHasAccountMembership: true,
      targetUserStatus: "disabled",
    });
    const request = new Request("https://worker.test/workspaces/current/members", {
      method: "POST",
      body: JSON.stringify({ userId: "target-1", role: "member" }),
    });
    const response = await handleAddWorkspaceMember(
      request,
      env,
      identity,
      identity.scope.workspaceId,
    );

    expect(response.status).toBe(404);
    expect(writes.some((write) => write.query.includes("INSERT INTO memberships"))).toBe(false);
  });
});
