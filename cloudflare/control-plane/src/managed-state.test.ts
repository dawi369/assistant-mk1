import { describe, expect, it } from "vitest";

import { handleGetManagedState, handleListManagedState, upsertManagedState } from "./managed-state";
import type { AgentIdentity, D1PreparedStatement, Env, MembershipRow } from "./types";

const identity: AgentIdentity = {
  scope: { userId: "user-1", workspaceId: "workspace-1" },
  agentId: "agent-1",
};

const membership: MembershipRow = {
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
};

const stateRow = {
  id: "state-1",
  user_id: "user-1",
  workspace_id: "workspace-1",
  agent_id: "agent-1",
  namespace: "reference-monitor",
  state_type: "endpoint",
  state_key: "primary",
  status: "healthy",
  summary: "Endpoint is healthy.",
  version: 2,
  artifact_refs_json: '["artifact-1"]',
  data_json: '{"statusCode":200}',
  created_at: "2026-07-12T00:00:00.000Z",
  updated_at: "2026-07-12T00:01:00.000Z",
};

const makeEnv = (options?: { writeChanges?: number; row?: typeof stateRow | null }) => {
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
            if (query.includes("FROM memberships")) return membership as T;
            return (options?.row === undefined ? stateRow : options.row) as T | null;
          },
          async all<T>() {
            return { results: [stateRow] as T[] };
          },
          async run() {
            return { success: true, meta: { changes: options?.writeChanges ?? 1 } };
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

describe("managed state", () => {
  it("lists only the trusted tenant and current agent scope", async () => {
    const { env, calls } = makeEnv();
    const response = await handleListManagedState(
      env,
      identity,
      new URL(
        "https://worker.test/workbench/managed-state?namespace=reference-monitor&type=endpoint&limit=500",
      ),
    );
    const body = (await response.json()) as {
      states: Array<Record<string, unknown>>;
      limit: number;
    };

    expect(response.status).toBe(200);
    expect(body.limit).toBe(100);
    expect(body.states[0]).toMatchObject({
      id: "state-1",
      namespace: "reference-monitor",
      stateType: "endpoint",
      version: 2,
      data: { statusCode: 200 },
    });
    expect(calls.at(-1)?.values).toEqual([
      "user-1",
      "workspace-1",
      "agent-1",
      "reference-monitor",
      "endpoint",
      100,
    ]);
  });

  it("returns 404 instead of leaking another scope's record", async () => {
    const { env, calls } = makeEnv({ row: null });
    const response = await handleGetManagedState(env, identity, "state-other");

    expect(response.status).toBe(404);
    expect(calls.at(-1)?.values).toEqual(["user-1", "workspace-1", "agent-1", "state-other"]);
  });

  it("uses optimistic version checks for workflow writes", async () => {
    const { env, calls } = makeEnv();
    const result = await upsertManagedState(env, identity, {
      namespace: "reference-monitor",
      stateType: "endpoint",
      stateKey: "primary",
      status: "healthy",
      expectedVersion: 1,
      data: { statusCode: 200 },
    });

    expect(result.ok).toBe(true);
    expect(calls[0]?.query).toContain("WHERE control_managed_state.version = ?");
    expect(calls[0]?.values.at(-1)).toBe(1);
  });

  it("rejects stale writes without reading or promoting state", async () => {
    const { env, calls } = makeEnv({ writeChanges: 0 });
    const result = await upsertManagedState(env, identity, {
      namespace: "reference-monitor",
      stateType: "endpoint",
      stateKey: "primary",
      status: "healthy",
      expectedVersion: 1,
    });

    expect(result).toEqual({ ok: false, reason: "version_conflict" });
    expect(calls).toHaveLength(1);
  });

  it("derives globally unique record ids from the full tenant scope", async () => {
    const first = makeEnv();
    const second = makeEnv();

    await upsertManagedState(first.env, identity, {
      namespace: "reference-monitor",
      stateType: "endpoint",
      stateKey: "primary",
      status: "healthy",
    });
    await upsertManagedState(
      second.env,
      {
        ...identity,
        scope: { ...identity.scope, userId: "user-2" },
      },
      {
        namespace: "reference-monitor",
        stateType: "endpoint",
        stateKey: "primary",
        status: "healthy",
      },
    );

    const firstId = first.calls[0]?.values[0];
    const secondId = second.calls[0]?.values[0];
    expect(firstId).toMatch(/^managed-[a-f0-9]{64}$/);
    expect(secondId).toMatch(/^managed-[a-f0-9]{64}$/);
    expect(secondId).not.toBe(firstId);
  });
});
