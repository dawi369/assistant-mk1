export const triggerStatuses = ["enabled", "paused", "disabled"] as const;
export type TriggerStatus = (typeof triggerStatuses)[number];

export const triggerDispatchStatuses = [
  "pending",
  "leased",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;
export type TriggerDispatchStatus = (typeof triggerDispatchStatuses)[number];

const triggerTransitions: Record<TriggerStatus, readonly TriggerStatus[]> = {
  enabled: ["paused", "disabled"],
  paused: ["enabled", "disabled"],
  disabled: [],
};

const dispatchTransitions: Record<TriggerDispatchStatus, readonly TriggerDispatchStatus[]> = {
  pending: ["leased", "cancelled"],
  leased: ["running", "failed", "cancelled"],
  running: ["completed", "failed", "cancelled"],
  completed: [],
  failed: ["leased"],
  cancelled: ["leased"],
};

export const canTransitionTrigger = (from: TriggerStatus, to: TriggerStatus) =>
  triggerTransitions[from].includes(to);

export const canTransitionTriggerDispatch = (
  from: TriggerDispatchStatus,
  to: TriggerDispatchStatus,
) => dispatchTransitions[from].includes(to);

export const isTerminalTriggerDispatchStatus = (status: TriggerDispatchStatus) =>
  status === "completed" || status === "failed" || status === "cancelled";
