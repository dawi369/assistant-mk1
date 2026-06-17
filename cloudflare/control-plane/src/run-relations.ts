import { isRecord } from "./http";

export type ControlRunRelation = {
  kind: "root" | "child";
  parentRunId?: string;
  rootRunId: string;
  depth: number;
  durableChild: boolean;
};

export type ControlRunRelationParent = {
  id: string;
  data: Record<string, unknown>;
};

const readBoolean = (value: unknown, fallback: boolean) =>
  typeof value === "boolean" ? value : fallback;

const readDepth = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;

export const readControlRunRelation = (
  data: Record<string, unknown>,
  runId?: string,
): ControlRunRelation | null => {
  const relation = isRecord(data.relation) ? data.relation : null;
  if (relation) {
    const parentRunId =
      typeof relation.parentRunId === "string" && relation.parentRunId.trim()
        ? relation.parentRunId.trim()
        : undefined;
    const rootRunId =
      typeof relation.rootRunId === "string" && relation.rootRunId.trim()
        ? relation.rootRunId.trim()
        : (parentRunId ?? runId);
    if (!rootRunId) return null;
    const depth = readDepth(relation.depth);
    return {
      kind: parentRunId ? "child" : "root",
      parentRunId,
      rootRunId,
      depth,
      durableChild: readBoolean(relation.durableChild, false),
    };
  }

  const legacyParentRunId =
    typeof data.parentRunId === "string" && data.parentRunId.trim()
      ? data.parentRunId.trim()
      : undefined;
  if (!legacyParentRunId) return null;
  return {
    kind: "child",
    parentRunId: legacyParentRunId,
    rootRunId: legacyParentRunId,
    depth: 1,
    durableChild: false,
  };
};

export const buildControlRunRelation = (input: {
  runId: string;
  parent?: ControlRunRelationParent | null;
  maxDepth?: number;
}): { ok: true; relation: ControlRunRelation } | { ok: false; code: string; reason: string } => {
  const maxDepth = input.maxDepth ?? 1;
  if (!input.parent) {
    return {
      ok: true,
      relation: {
        kind: "root",
        rootRunId: input.runId,
        depth: 0,
        durableChild: false,
      },
    };
  }

  const parentRelation = readControlRunRelation(input.parent.data, input.parent.id);
  const parentDepth = parentRelation?.depth ?? 0;
  const depth = parentDepth + 1;
  if (depth > maxDepth) {
    return {
      ok: false,
      code: "child_run_depth_exceeded",
      reason: `Child run depth ${depth} exceeds the configured max depth of ${maxDepth}.`,
    };
  }

  return {
    ok: true,
    relation: {
      kind: "child",
      parentRunId: input.parent.id,
      rootRunId: parentRelation?.rootRunId ?? input.parent.id,
      depth,
      durableChild: false,
    },
  };
};

export const toControlRunRelationEventData = (relation: ControlRunRelation) => ({
  kind: relation.kind,
  parentRunId: relation.parentRunId,
  rootRunId: relation.rootRunId,
  depth: relation.depth,
  durableChild: relation.durableChild,
});
