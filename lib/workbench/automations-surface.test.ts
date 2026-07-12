import { describe, expect, it } from "vitest";

import { canReplayDispatch, configuredTriggerFor } from "./automations-surface";
import type { TriggerDispatchSummary, TriggerSummary } from "./workbench-types";

const trigger: TriggerSummary = {
  id: "trigger-1",
  agentId: "agent-1",
  packId: "repo-analyst",
  packTriggerId: "scheduled-readiness",
  kind: "schedule",
  workflowType: "repo.readiness_report",
  status: "enabled",
  execution: { mode: "dry_run" },
  config: { cron: "0 9 * * 1", timezone: "UTC" },
  input: {},
  maxConcurrentRuns: 1,
  version: 1,
  createdAt: "2026-07-12T00:00:00.000Z",
  updatedAt: "2026-07-12T00:00:00.000Z",
};

const dispatch = (status: TriggerDispatchSummary["status"]): TriggerDispatchSummary => ({
  id: `dispatch-${status}`,
  triggerId: trigger.id,
  agentId: trigger.agentId,
  idempotencyKey: `manual:${status}`,
  source: "manual",
  status,
  attemptCount: 0,
  receivedAt: "2026-07-12T00:01:00.000Z",
  payload: {},
  error: {},
  createdAt: "2026-07-12T00:01:00.000Z",
  updatedAt: "2026-07-12T00:01:00.000Z",
});

describe("workbench automations surface", () => {
  it("matches configured records to the current pack declaration", () => {
    expect(
      configuredTriggerFor(
        {
          id: "scheduled-readiness",
          kind: "schedule",
          description: "Periodic readiness report.",
          workflowType: "repo.readiness_report",
          enabledByDefault: false,
        },
        [trigger],
      ),
    ).toBe(trigger);
  });

  it("offers replay only for failed or cancelled dispatches", () => {
    expect(canReplayDispatch(dispatch("failed"))).toBe(true);
    expect(canReplayDispatch(dispatch("cancelled"))).toBe(true);
    expect(canReplayDispatch(dispatch("completed"))).toBe(false);
    expect(canReplayDispatch(dispatch("running"))).toBe(false);
  });
});
