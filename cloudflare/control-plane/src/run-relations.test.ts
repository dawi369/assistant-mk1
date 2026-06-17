import { describe, expect, it } from "vitest";

import { buildControlRunRelation, readControlRunRelation } from "./run-relations";

describe("control run relations", () => {
  it("creates root relations for top-level runs", () => {
    const result = buildControlRunRelation({ runId: "cf-run-root" });

    expect(result).toEqual({
      ok: true,
      relation: {
        kind: "root",
        rootRunId: "cf-run-root",
        depth: 0,
        durableChild: false,
      },
    });
  });

  it("creates bounded child relations from parent run data", () => {
    const result = buildControlRunRelation({
      runId: "cf-run-child",
      parent: {
        id: "cf-run-parent",
        data: {
          relation: {
            kind: "root",
            rootRunId: "cf-run-parent",
            depth: 0,
            durableChild: false,
          },
        },
      },
    });

    expect(result).toEqual({
      ok: true,
      relation: {
        kind: "child",
        parentRunId: "cf-run-parent",
        rootRunId: "cf-run-parent",
        depth: 1,
        durableChild: false,
      },
    });
  });

  it("blocks child depth beyond the configured max", () => {
    const result = buildControlRunRelation({
      runId: "cf-run-grandchild",
      parent: {
        id: "cf-run-child",
        data: {
          relation: {
            kind: "child",
            parentRunId: "cf-run-parent",
            rootRunId: "cf-run-parent",
            depth: 1,
            durableChild: false,
          },
        },
      },
      maxDepth: 1,
    });

    expect(result).toMatchObject({
      ok: false,
      code: "child_run_depth_exceeded",
    });
  });

  it("reads legacy parentRunId values as child relations", () => {
    expect(readControlRunRelation({ parentRunId: "chat-run-1" })).toEqual({
      kind: "child",
      parentRunId: "chat-run-1",
      rootRunId: "chat-run-1",
      depth: 1,
      durableChild: false,
    });
  });
});
