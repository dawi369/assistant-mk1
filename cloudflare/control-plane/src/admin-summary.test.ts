import { describe, expect, it, vi } from "vitest";

import { buildAdminWorkspaceSummary, type AdminSummaryReaders } from "./admin-summary";
import type { AgentIdentity, Env } from "./types";

const timestamp = "2026-06-18T12:00:00.000Z";

const identity = {
  agentId: "agent_1",
  scope: {
    userId: "user_1",
    workspaceId: "workspace_1",
    accountId: "account_1",
    accountSource: "workos-organization",
  },
  accountId: "account_1",
  accountSource: "workos-organization",
} as AgentIdentity;

const env = {} as Env;

const user = {
  id: identity.scope.userId,
  email: "user@example.com",
  display_name: "User",
  status: "active",
  data_json: "{}",
  created_at: timestamp,
  updated_at: timestamp,
};

const workspace = {
  id: identity.scope.workspaceId,
  account_id: identity.accountId,
  account_source: identity.accountSource,
  name: "Workspace",
  status: "active",
  is_default: 1,
  created_by_user_id: identity.scope.userId,
  data_json: "{}",
  created_at: timestamp,
  updated_at: timestamp,
};

const membership = {
  id: "membership_1",
  user_id: identity.scope.userId,
  workspace_id: identity.scope.workspaceId,
  role: "owner",
  status: "active",
  roles_json: JSON.stringify(["owner"]),
  permissions_json: JSON.stringify(["workbench:read"]),
  data_json: "{}",
  created_at: timestamp,
  updated_at: timestamp,
};

const agent = {
  id: identity.agentId,
  workspace_id: identity.scope.workspaceId,
  name: "Agent",
  description: null,
  status: "active",
  is_default: 1,
  created_by_user_id: identity.scope.userId,
  data_json: JSON.stringify({ profile: "analyst" }),
  created_at: timestamp,
  updated_at: timestamp,
};

const chatRuntime = {
  state: "thread_ready",
  latestSession: null,
  latestThread: null,
  latestRun: null,
  latestIntent: null,
  latestPolicyDecision: null,
  timings: null,
  events: [],
  failure: null,
};

const demoRun = {
  id: "run_1",
  user_id: identity.scope.userId,
  workspace_id: identity.scope.workspaceId,
  agent_id: identity.agentId,
  workflow_intent_id: "intent_1",
  status: "completed",
  execution_json: "{}",
  stage: "observe",
  engine: "cloudflare",
  heartbeat_at: timestamp,
  last_event_at: timestamp,
  completed_at: timestamp,
  failed_at: null,
  data_json: "{}",
  created_at: timestamp,
  updated_at: timestamp,
};

const createReaders = (heavyReader?: () => unknown): AdminSummaryReaders =>
  ({
    selectUser: vi.fn(() => Promise.resolve(user)),
    selectWorkspace: vi.fn(() => Promise.resolve(workspace)),
    selectMembership: vi.fn(() => Promise.resolve(membership)),
    selectAgent: vi.fn(() => Promise.resolve(agent)),
    selectDefaultAgent: vi.fn(() => Promise.resolve(agent)),
    selectWorkspaceAgents: vi.fn(() => Promise.resolve({ results: [agent] })),
    selectAccountWorkspacesForUser: vi.fn(() => Promise.resolve({ results: [workspace] })),
    getChatRuntimeSummary: vi.fn(() => Promise.resolve(chatRuntime)),
    handleLatestControlPlaneEvents: vi.fn(() =>
      Promise.resolve({
        ok: true,
        events: [{ id: "event_1", type: "chat.run.completed", summary: "done" }],
      }),
    ),
    latestFailedControlRun: vi.fn(() => Promise.resolve(null)),
    latestErrorEvent: vi.fn(() => Promise.resolve(null)),
    readLatestControlRun: vi.fn(() =>
      heavyReader ? Promise.resolve(heavyReader()) : Promise.resolve(demoRun),
    ),
    resolveToolSummaries: vi.fn(() =>
      heavyReader
        ? Promise.resolve(heavyReader())
        : Promise.resolve({
            context: {
              stage: "observe",
              executionMode: "dry_run",
              surface: "model_exposure",
              platform: "cloudflare-control-plane",
              featureFlags: [],
            },
            decisions: [],
            tools: [{ name: "url.inspect" }],
          }),
    ),
    listLatestToolCalls: vi.fn(() =>
      heavyReader ? Promise.resolve(heavyReader()) : Promise.resolve([{ id: "call_1" }]),
    ),
    listLatestArtifacts: vi.fn(() =>
      heavyReader ? Promise.resolve(heavyReader()) : Promise.resolve([{ id: "artifact_1" }]),
    ),
    getLatestRuntimeTraceSnapshot: vi.fn(() =>
      heavyReader
        ? Promise.resolve(heavyReader())
        : Promise.resolve({ trace: { traceId: "trace_1" }, spans: [{ spanId: "span_1" }] }),
    ),
    listRuntimeTraceSummaries: vi.fn(() =>
      heavyReader ? Promise.resolve(heavyReader()) : Promise.resolve([{ traceId: "trace_1" }]),
    ),
    getControlRunSnapshot: vi.fn(() =>
      Promise.resolve({
        scope: identity.scope,
        intent: null,
        run: { id: demoRun.id, status: demoRun.status },
        toolCalls: [],
        artifacts: [],
        decisions: [],
        auditEvents: [],
      }),
    ),
  }) as unknown as AdminSummaryReaders;

describe("admin workspace summary projections", () => {
  it("compact projection skips heavy drawer readers and returns compatible defaults", async () => {
    const heavyReader = vi.fn(() => {
      throw new Error("heavy reader should not run");
    });
    const readers = createReaders(heavyReader);

    const body = await buildAdminWorkspaceSummary(
      new Request("https://worker.test/admin/workspace-summary?projection=compact"),
      env,
      identity,
      { readers },
    );

    expect(body.summary.diagnostics.projection).toBe("compact");
    expect(body.summary.tools).toEqual([]);
    expect(body.summary.latestToolCalls).toEqual([]);
    expect(body.summary.latestArtifacts).toEqual([]);
    expect(body.summary.latestTrace).toBeNull();
    expect(body.summary.traceWaterfall).toEqual([]);
    expect(body.summary.demo.latestRun).toBeNull();
    expect(heavyReader).not.toHaveBeenCalled();
  });

  it("defaults to drawer projection and runs heavy drawer readers", async () => {
    const readers = createReaders();

    const body = await buildAdminWorkspaceSummary(
      new Request("https://worker.test/admin/workspace-summary"),
      env,
      identity,
      { readers },
    );

    expect(body.summary.diagnostics.projection).toBe("drawer");
    expect(body.summary.tools).toHaveLength(1);
    expect(body.summary.latestToolCalls).toHaveLength(1);
    expect(body.summary.latestArtifacts).toHaveLength(1);
    expect(body.summary.latestTrace?.traceId).toBe("trace_1");
    expect(body.summary.traceWaterfall).toHaveLength(1);
    expect(body.summary.demo.latestRun?.run?.id).toBe(demoRun.id);
    expect(readers.resolveToolSummaries).toHaveBeenCalled();
    expect(readers.getLatestRuntimeTraceSnapshot).toHaveBeenCalled();
  });
});
