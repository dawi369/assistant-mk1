export type ExternalSignalAction = "start" | "resume" | "create_cron" | "dispatch_schedule";

export type ExternalSignalPayload = {
  action: ExternalSignalAction;
  assistantId?: string;
  threadId?: string;
  input?: Record<string, unknown> | null;
  command?: unknown;
  schedule?: string;
  scheduleId?: string;
  scheduledFor?: string;
  dispatchId?: string;
  timezone?: string;
  webhook?: string;
  metadata?: Record<string, unknown>;
};

export type ScheduleDispatchMetadata = {
  kind: "schedule";
  scheduleId: string;
  dispatchId: string;
  scheduledFor?: string;
  dispatchedAt: string;
  owner: "control-plane-root";
  source: "external_signal";
};

export type NormalizedExternalSignal = {
  action: ExternalSignalAction;
  assistantId?: string;
  threadId?: string;
  input: Record<string, unknown> | null;
  command?: unknown;
  schedule?: string;
  timezone?: string;
  webhook?: string;
  metadata: Record<string, unknown>;
  scheduleDispatch?: ScheduleDispatchMetadata;
};

export type NormalizeExternalSignalResult =
  | { ok: true; signal: NormalizedExternalSignal }
  | { ok: false; status: number; error: string };

const trimString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const safeMetadata = (metadata: unknown) =>
  metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {};

const createDispatchId = (scheduleId: string, dispatchedAt: string) =>
  `schedule-dispatch:${scheduleId}:${dispatchedAt}`;

export const normalizeExternalSignal = (
  payload: ExternalSignalPayload,
  input: { now?: Date } = {},
): NormalizeExternalSignalResult => {
  const now = input.now ?? new Date();
  const metadata = {
    source: "external-signal",
    ...safeMetadata(payload.metadata),
  };

  if (payload.action === "create_cron") {
    const schedule = trimString(payload.schedule);
    if (!schedule) {
      return { ok: false, status: 400, error: "schedule is required for create_cron" };
    }

    const scheduleId = trimString(payload.scheduleId);
    const cronMetadata = scheduleId
      ? {
          ...metadata,
          schedule: {
            kind: "schedule",
            scheduleId,
            owner: "control-plane-root",
            source: "external_signal",
          },
        }
      : metadata;
    return {
      ok: true,
      signal: {
        action: payload.action,
        assistantId: trimString(payload.assistantId) || undefined,
        input: payload.input ?? null,
        schedule,
        timezone: trimString(payload.timezone) || undefined,
        webhook: trimString(payload.webhook) || undefined,
        metadata: cronMetadata,
      },
    };
  }

  if (payload.action === "dispatch_schedule") {
    const scheduleId = trimString(payload.scheduleId);
    if (!scheduleId) {
      return { ok: false, status: 400, error: "scheduleId is required for dispatch_schedule" };
    }

    const dispatchedAt = now.toISOString();
    const scheduleDispatch: ScheduleDispatchMetadata = {
      kind: "schedule",
      scheduleId,
      dispatchId: trimString(payload.dispatchId) || createDispatchId(scheduleId, dispatchedAt),
      scheduledFor: trimString(payload.scheduledFor) || undefined,
      dispatchedAt,
      owner: "control-plane-root",
      source: "external_signal",
    };

    return {
      ok: true,
      signal: {
        action: payload.action,
        assistantId: trimString(payload.assistantId) || undefined,
        threadId: trimString(payload.threadId) || undefined,
        input: payload.input ?? null,
        webhook: trimString(payload.webhook) || undefined,
        metadata: {
          ...metadata,
          source: "schedule-dispatch",
          scheduleDispatch,
        },
        scheduleDispatch,
      },
    };
  }

  return {
    ok: true,
    signal: {
      action: payload.action,
      assistantId: trimString(payload.assistantId) || undefined,
      threadId: trimString(payload.threadId) || undefined,
      input: payload.action === "start" ? (payload.input ?? null) : null,
      command: payload.action === "resume" ? payload.command : undefined,
      webhook: trimString(payload.webhook) || undefined,
      metadata,
    },
  };
};
