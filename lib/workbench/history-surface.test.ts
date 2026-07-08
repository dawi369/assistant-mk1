import { describe, expect, it } from "vitest";

import {
  buildArtifactPreview,
  filterHistoryRuns,
  isOpenableArtifactUri,
  resolveFocusedRunId,
} from "./history-surface";
import type { ArtifactSummary, ExecutionHistoryRunSummary } from "./workbench-types";

const runs = [
  {
    id: "workflow-run",
    workflowIntentId: "intent-1",
    status: "completed",
    stage: "analyze",
    artifactIds: ["artifact-1"],
    toolCallCount: 3,
  },
  {
    id: "tool-run",
    status: "completed",
    stage: "observe",
    toolCallCount: 1,
  },
  {
    id: "failed-run",
    status: "failed",
    toolCallCount: 0,
  },
] satisfies ExecutionHistoryRunSummary[];

describe("history surface helpers", () => {
  it("classifies and filters workflow, tool, artifact, and failed runs", () => {
    expect(filterHistoryRuns(runs, "all").map((run) => run.id)).toEqual([
      "workflow-run",
      "tool-run",
      "failed-run",
    ]);
    expect(filterHistoryRuns(runs, "workflows").map((run) => run.id)).toEqual(["workflow-run"]);
    expect(filterHistoryRuns(runs, "tools").map((run) => run.id)).toEqual(["tool-run"]);
    expect(filterHistoryRuns(runs, "artifacts").map((run) => run.id)).toEqual(["workflow-run"]);
    expect(filterHistoryRuns(runs, "failed").map((run) => run.id)).toEqual(["failed-run"]);
  });

  it("resolves focused run ids and falls back to the newest loaded run", () => {
    expect(resolveFocusedRunId(runs, { runId: "tool-run", createdAt: 1 })).toBe("tool-run");
    expect(resolveFocusedRunId(runs, { artifactId: "artifact-1", createdAt: 1 })).toBe(
      "workflow-run",
    );
    expect(resolveFocusedRunId(runs, { runId: "missing", createdAt: 1 })).toBe("workflow-run");
    expect(resolveFocusedRunId([], { runId: "missing", createdAt: 1 })).toBeNull();
  });

  it("formats artifact previews and gates openable URIs", () => {
    const artifact = {
      id: "artifact-1",
      title: "Market research",
      uri: "d1://control-plane/artifact-1/report.json",
      data: {
        summary: "Public market research summary.",
        report: "Longer markdown report.",
      },
    } satisfies ArtifactSummary;

    expect(buildArtifactPreview(artifact)).toMatchObject({
      title: "Market research",
      lines: [
        "Public market research summary.",
        "Longer markdown report.",
        "d1://control-plane/artifact-1/report.json",
      ],
    });
    expect(buildArtifactPreview(artifact).json).toContain("Public market research summary");
    expect(isOpenableArtifactUri("https://example.com/report.json")).toBe(true);
    expect(isOpenableArtifactUri("http://example.com/report.json")).toBe(true);
    expect(isOpenableArtifactUri("d1://control-plane/artifact-1/report.json")).toBe(false);
    expect(isOpenableArtifactUri("not a url")).toBe(false);
  });
});
