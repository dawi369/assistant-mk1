import { describe, expect, it, vi } from "vitest";

import { createAgentBehaviorSnapshot } from "./agent-behavior-templates";
import { handlePolymancerMarketResearch } from "./polymancer-workflows";
import type { AgentIdentity, D1PreparedStatement, D1Result, Env } from "./types";

vi.mock("../../../lib/workbench/polymarket-readonly", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/workbench/polymarket-readonly")>(
    "../../../lib/workbench/polymarket-readonly",
  );
  return {
    ...actual,
    runPolymarketMarketSearch: vi.fn(async () => ({
      ok: true,
      output: {
        status: "ok",
        summary: "Found 1 public Polymarket market.",
        source: "gamma",
        markets: [
          {
            id: "market-1",
            slug: "new-rhianna-album-before-gta-vi-926",
            question: "New Rihanna Album before GTA VI?",
            active: true,
            closed: false,
            endDate: "2026-07-31T12:00:00Z",
            volume: "100",
            liquidity: "50",
            outcomes: ["Yes", "No"],
            outcomePrices: ["0.51", "0.49"],
            clobTokenIds: ["token-yes", "token-no"],
          },
        ],
        timingMs: 12,
      },
    })),
    runPolymarketMarketSnapshot: vi.fn(async () => ({
      ok: true,
      output: {
        status: "ok",
        summary: "Loaded public market: New Rihanna Album before GTA VI?",
        source: "gamma",
        market: {
          id: "market-1",
          slug: "new-rhianna-album-before-gta-vi-926",
          question: "New Rihanna Album before GTA VI?",
          active: true,
          closed: false,
          endDate: "2026-07-31T12:00:00Z",
          volume: "100",
          liquidity: "50",
          outcomes: ["Yes", "No"],
          outcomePrices: ["0.51", "0.49"],
          clobTokenIds: ["token-yes", "token-no"],
        },
        timingMs: 9,
      },
    })),
    runPolymarketOrderbookSnapshot: vi.fn(async () => ({
      ok: true,
      output: {
        status: "ok",
        summary: "Loaded public order book with 1 bid and 1 ask.",
        source: "clob",
        tokenId: "token-yes",
        bestBid: "0.5",
        bestAsk: "0.52",
        spread: "0.0200",
        bidCount: 1,
        askCount: 1,
        topBids: [{ price: "0.5", size: "10" }],
        topAsks: [{ price: "0.52", size: "8" }],
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
  name: "Baby Polymancer",
  description: null,
  status: "active",
  is_default: 0,
  created_by_user_id: identity.scope.userId,
  data_json: JSON.stringify({ profile: "analyst", behavior }),
  created_at: "2026-06-23T00:00:00.000Z",
  updated_at: "2026-06-23T00:00:00.000Z",
});

const createRecordingEnv = (input?: {
  packTemplateId?: "pack-baby-polymancer" | "pack-repo-analyst";
}) => {
  const statements: RecordedStatement[] = [];
  const behavior = createAgentBehaviorSnapshot(
    "analyst",
    input?.packTemplateId ?? "pack-baby-polymancer",
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

describe("polymancer market research workflow", () => {
  it("records a read-only workflow run, tool calls, and report artifact", async () => {
    const { env, statements } = createRecordingEnv();
    const request = new Request("https://worker.test/workflows/polymancer/market-research", {
      method: "POST",
      body: JSON.stringify({ executionMode: "dry_run", input: { query: "GTA", limit: 1 } }),
    });

    const response = await handlePolymancerMarketResearch(request, env, identity);
    const body = (await response.json()) as { ok?: boolean; run?: { workflowType?: string } };

    expect(response.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.run?.workflowType).toBe("polymancer.market_research");

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
          JSON.stringify(statement.values).includes("market_research_report"),
      ),
    ).toBe(true);
    expect(
      statements.some(
        (statement) =>
          statement.query.includes("UPDATE control_runs") &&
          statement.values.includes("completed") &&
          JSON.stringify(statement.values).includes("polymancer.market_research"),
      ),
    ).toBe(true);
  });

  it("requires the active Baby Polymancer pack", async () => {
    const { env, statements } = createRecordingEnv({ packTemplateId: "pack-repo-analyst" });
    const request = new Request("https://worker.test/workflows/polymancer/market-research", {
      method: "POST",
      body: JSON.stringify({ executionMode: "dry_run", input: { query: "GTA", limit: 1 } }),
    });

    const response = await handlePolymancerMarketResearch(request, env, identity);
    const body = (await response.json()) as { details?: { code?: string } };

    expect(response.status).toBe(403);
    expect(body.details?.code).toBe("pack_required");
    expect(statements).toHaveLength(0);
  });
});
