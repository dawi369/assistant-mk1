import { describe, expect, it, vi } from "vitest";

import { createAgentBehaviorSnapshot } from "./agent-behavior-templates";
import { handleRepoReadinessReport } from "./repo-workflows";
import type { AgentIdentity, D1PreparedStatement, D1Result, Env } from "./types";

vi.mock("./tool-runner", async () => {
  const actual = await vi.importActual<typeof import("./tool-runner")>("./tool-runner");
  return {
    ...actual,
    invokeFlyToolRunner: vi.fn(async () => ({
      ok: true,
      output: {
        status: "ok",
        summary: "Captured bounded repository snapshot.",
        packageManager: "pnpm",
        scripts: ["build", "lint", "typecheck", "test"],
        repoFiles: ["package.json", "app/page.tsx", "docs/README.md"],
        docs: ["README.md", "docs/README.md"],
        configFiles: ["tsconfig.json"],
        signals: [{ kind: "runtime", title: "Framework", value: "Next.js" }],
        commandMetrics: [
          {
            name: "inventory",
            command: "rg --files",
            status: "completed",
            durationMs: 12,
            exitCode: 0,
            stdoutBytes: 100,
            stderrBytes: 0,
          },
        ],
        timingMs: 15,
      },
    })),
  };
});

type RecordedStatement = { query: string; values: unknown[] };

const identity = {
  agentId: "agent-repo",
  scope: { userId: "user-1", workspaceId: "workspace-1" },
  accountId: "account-1",
  accountSource: "test",
} satisfies AgentIdentity;

const createEnv = () => {
  const statements: RecordedStatement[] = [];
  const behavior = createAgentBehaviorSnapshot("analyst", "pack-repo-analyst");
  const createStatement = (query: string): D1PreparedStatement & RecordedStatement => {
    const statement = {
      query,
      values: [] as unknown[],
      bind(...values: unknown[]) {
        statement.values = values;
        return statement;
      },
      async first<T = unknown>() {
        if (query.includes("FROM memberships")) {
          return {
            id: "membership-1",
            user_id: identity.scope.userId,
            workspace_id: identity.scope.workspaceId,
            role: "member",
            status: "active",
            roles_json: "[]",
            permissions_json: "[]",
            data_json: "{}",
            created_at: "2026-07-10T00:00:00.000Z",
            updated_at: "2026-07-10T00:00:00.000Z",
          } as T;
        }
        if (query.includes("FROM agents")) {
          return {
            id: identity.agentId,
            workspace_id: identity.scope.workspaceId,
            name: "Repository Analyst",
            description: null,
            status: "active",
            is_default: 0,
            created_by_user_id: identity.scope.userId,
            data_json: JSON.stringify({ profile: "analyst", behavior }),
            created_at: "2026-07-10T00:00:00.000Z",
            updated_at: "2026-07-10T00:00:00.000Z",
          } as T;
        }
        if (query.includes("SELECT version") && query.includes("control_managed_state")) {
          return null as T | null;
        }
        if (query.includes("FROM control_managed_state")) {
          return {
            id: `${identity.agentId}-repo-readiness-current`,
            user_id: identity.scope.userId,
            workspace_id: identity.scope.workspaceId,
            agent_id: identity.agentId,
            namespace: "repo-monitor",
            state_type: "repository-readiness",
            state_key: "current",
            status: "ready",
            summary: "Repository is ready.",
            version: 1,
            artifact_refs_json: "[]",
            data_json: "{}",
            created_at: "2026-07-10T00:00:00.000Z",
            updated_at: "2026-07-10T00:00:00.000Z",
          } as T;
        }
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
    WORKBENCH_RUNNER_URL: "https://runner.test/invoke",
    WORKBENCH_RUNNER_SIGNING_SECRET: "test-secret",
    DB: {
      prepare: createStatement,
      async batch(batchStatements: Array<D1PreparedStatement & Partial<RecordedStatement>>) {
        for (const statement of batchStatements) {
          statements.push({ query: statement.query ?? "unknown", values: statement.values ?? [] });
        }
        return batchStatements.map(() => ({ success: true })) as D1Result[];
      },
    },
  } satisfies Partial<Env>;
  return { env: env as Env, statements };
};

describe("Repository Analyst readiness workflow", () => {
  it("records one snapshot tool call and a structured readiness artifact", async () => {
    const { env, statements } = createEnv();
    const response = await handleRepoReadinessReport(
      new Request("https://worker.test/workflows/repo/readiness-report", {
        method: "POST",
        body: JSON.stringify({
          executionMode: "dry_run",
          input: { includeDocs: true, includeScripts: true, includeConfig: true },
        }),
      }),
      env,
      identity,
    );
    const body = (await response.json()) as {
      report?: { status?: string; verificationScripts?: string[] };
      artifact?: { kind?: string };
    };

    expect(response.status).toBe(201);
    expect(body.report?.status).toBe("ready");
    expect(body.report?.verificationScripts).toEqual(["build", "lint", "typecheck", "test"]);
    expect(body.artifact?.kind).toBe("repo_readiness_report");
    expect(
      statements.filter((statement) => statement.query.includes("INSERT INTO control_tool_calls")),
    ).toHaveLength(1);
    expect(
      statements.some(
        (statement) =>
          statement.query.includes("INSERT INTO control_artifacts") &&
          statement.values.includes("repo_readiness_report"),
      ),
    ).toBe(true);
  });
});
