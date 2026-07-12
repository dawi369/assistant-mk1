import type {
  AgentPackTemplateMetadata,
  TriggerDispatchSummary,
  TriggerSummary,
} from "./workbench-types";

type DeclaredTrigger = NonNullable<AgentPackTemplateMetadata["triggers"]>[number];

export const configuredTriggerFor = (declared: DeclaredTrigger, triggers: TriggerSummary[]) =>
  triggers.find((trigger) => trigger.packTriggerId === declared.id) ?? null;

export const canReplayDispatch = (dispatch: TriggerDispatchSummary) =>
  dispatch.status === "failed" || dispatch.status === "cancelled";
