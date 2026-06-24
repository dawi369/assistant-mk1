import { describe, expect, it, vi } from "vitest";

import { createAgentBehaviorSnapshot } from "./agent-behavior-templates";
import { handleSwordfishRuntimeResearch } from "./swordfish-workflows";
import type { AgentIdentity, D1PreparedStatement, D1Result, Env } from "./types";

vi.mock("../../../lib/workbench/swordfish-readonly", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/workbench/swordfish-readonly")>(
    "../../../lib/workbench/swordfish-readonly",
  );
  return {
    ...actual,
    runSwordfishRuntimeOverview: vi.fn(async () => ({
      ok: true,
      output: {
        status: "ok",
        summary:
          "Swordfish public runtime is ok (redis=connected, timescaledb=connected, massiveWs=connected).",
        source: "swordfish_public",
        backendBaseUrl: "https://swordfish-backend-production.up.railway.app",
        health: {
          status: "ok",
          timestamp: 123,
          services: { redis: "connected", timescaledb: "connected", massiveWs: "connected" },
        },
        openTicker: "ESH6",
        symbolCount: 2,
        sampleSymbols: ["ESH6", "NQH6"],
        snapshotCount: 2,
        timingMs: 12,
      },
    })),
    runSwordfishSymbolSnapshot: vi.fn(async () => ({
      ok: true,
      output: {
        status: "ok",
        summary: "Loaded public Swordfish snapshot for ESH6.",
        source: "swordfish_public",
        symbol: "ESH6",
        snapshot: {
          ticker: "ESH6",
          productCode: "ES",
          timestamp: 123,
          settlementPrice: 5010,
        },
        timingMs: 9,
      },
    })),
    runSwordfishBarsRange: vi.fn(async () => ({
      ok: true,
      output: {
        status: "ok",
        summary: "Loaded 2 public Swordfish 1m bars for ESH6.",
        source: "swordfish_public",
        symbol: "ESH6",
        tf: "1m",
        start: 1,
        end: 2,
        count: 2,
        returnedBars: 2,
        dataSource: "redis",
        bars: [
          { ts: 1, open: 1, high: 2, low: 1, close: 2 },
          { ts: 2, open: 2, high: 3, low: 2, close: 3 },
        ],
        timingMs: 7,
      },
    })),
  };
});

type RecordedStatement = {
  query: string;
  values: unknown[];
};

const identity = {
  agentId: "agent-1",
  scope: {
    userId: "user-1",
    workspaceId: "workspace-1",
    accountId: "account-1",
    accountSource: "test",
  },
} as AgentIdentity;

const agentRow = (behavior: unknown) => ({
  id: identity.agentId,
  workspace_id: identity.scope.workspaceId,
  name: "Baby Swordfish",
  description: null,
  status: "active",
  is_default: 0,
  created_by_user_id: identity.scope.userId,
  data_json: JSON.stringify({ profile: "analyst", behavior }),
  created_at: "2026-06-23T00:00:00.000Z",
  updated_at: "2026-06-23T00:00:00.000Z",
});

const createRecordingEnv = (input?: {
  packTemplateId?: "pack-baby-swordfish" | "pack-repo-analyst";
}) => {
  const statements: RecordedStatement[] = [];
  const behavior = createAgentBehaviorSnapshot(
    "analyst",
    input?.packTemplateId ?? "pack-baby-swordfish",
  );
  const createStatement = (query: string): D1PreparedStatement & RecordedStatement => {
    const statement = {
      query,
      values: [] as unknown[],
      bind(...values: unknown[]) {
        statement.values = values;
        return statement;
      },
      async first<T = unknown>() {
        if (query.includes("FROM agents")) return agentRow(behavior) as T;
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

describe("swordfish runtime research workflow", () => {
  it("records a read-only workflow run, tool calls, and report artifact", async () => {
    const { env, statements } = createRecordingEnv();
    const request = new Request("https://worker.test/workflows/swordfish/runtime-research", {
      method: "POST",
      body: JSON.stringify({
        executionMode: "dry_run",
        input: { symbol: "ESH6", lookbackMinutes: 60, maxBars: 2 },
      }),
    });

    const response = await handleSwordfishRuntimeResearch(request, env, identity);
    const body = (await response.json()) as { ok?: boolean; run?: { workflowType?: string } };

    expect(response.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.run?.workflowType).toBe("swordfish.runtime_research");

    expect(
      statements.some((statement) =>
        statement.query.includes("INSERT INTO control_workflow_intents"),
      ),
    ).toBe(true);
    expect(
      statements.some((statement) => statement.query.includes("INSERT INTO control_runs")),
    ).toBe(true);
    expect(
      statements.filter((statement) => statement.query.includes("INSERT INTO control_tool_calls")),
    ).toHaveLength(3);
    expect(
      statements.some((statement) => statement.query.includes("INSERT INTO control_artifacts")),
    ).toBe(true);
    expect(
      statements.some(
        (statement) =>
          statement.query.includes("UPDATE control_tool_calls") &&
          JSON.stringify(statement.values).includes("runtime_research_report"),
      ),
    ).toBe(true);
    expect(
      statements.some(
        (statement) =>
          statement.query.includes("UPDATE control_runs") &&
          statement.values.includes("completed") &&
          JSON.stringify(statement.values).includes("swordfish.runtime_research"),
      ),
    ).toBe(true);
  });

  it("requires the active Baby Swordfish pack", async () => {
    const { env, statements } = createRecordingEnv({ packTemplateId: "pack-repo-analyst" });
    const request = new Request("https://worker.test/workflows/swordfish/runtime-research", {
      method: "POST",
      body: JSON.stringify({ executionMode: "dry_run", input: { symbol: "ESH6" } }),
    });

    const response = await handleSwordfishRuntimeResearch(request, env, identity);
    const body = (await response.json()) as { details?: { code?: string } };

    expect(response.status).toBe(403);
    expect(body.details?.code).toBe("pack_required");
    expect(statements).toHaveLength(0);
  });
});
