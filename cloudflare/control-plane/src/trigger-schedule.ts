import { Cron } from "croner";

const minimumMonitorIntervalSeconds = 60;
const maximumMonitorIntervalSeconds = 86_400;
const maximumCoalescedOccurrences = 10_000;

const requireTimezone = (timezone: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date(0));
  } catch {
    throw new Error("timezone must be a valid IANA time zone");
  }
};

export const nextCronOccurrence = (input: { cron: string; timezone: string; after: Date }) => {
  const expression = input.cron.trim();
  if (expression.split(/\s+/).length !== 5) {
    throw new Error("cron must use exactly five fields");
  }
  requireTimezone(input.timezone);
  const schedule = new Cron(expression, {
    timezone: input.timezone,
    paused: true,
    mode: "5-part",
  });
  const next = schedule.nextRun(input.after);
  if (!next) throw new Error("cron does not produce a future occurrence");
  return next;
};

export const nextMonitorOccurrence = (input: { intervalSeconds: number; after: Date }) => {
  if (
    !Number.isSafeInteger(input.intervalSeconds) ||
    input.intervalSeconds < minimumMonitorIntervalSeconds ||
    input.intervalSeconds > maximumMonitorIntervalSeconds
  ) {
    throw new Error(
      `monitor interval must be between ${minimumMonitorIntervalSeconds} and ${maximumMonitorIntervalSeconds} seconds`,
    );
  }
  return new Date(input.after.getTime() + input.intervalSeconds * 1000);
};

export const coalesceDueOccurrence = (input: {
  kind: "schedule" | "monitor";
  config: { cron?: string; timezone?: string; intervalSeconds?: number };
  scheduledFor: Date;
  now: Date;
}) => {
  if (input.scheduledFor.getTime() > input.now.getTime()) {
    return { due: false as const, nextTriggerAt: input.scheduledFor, skippedOccurrences: 0 };
  }

  let cursor = input.scheduledFor;
  let occurrences = 1;
  while (cursor.getTime() <= input.now.getTime()) {
    cursor =
      input.kind === "schedule"
        ? nextCronOccurrence({
            cron: input.config.cron ?? "",
            timezone: input.config.timezone ?? "",
            after: cursor,
          })
        : nextMonitorOccurrence({
            intervalSeconds: input.config.intervalSeconds ?? 0,
            after: cursor,
          });
    if (cursor.getTime() <= input.now.getTime()) occurrences += 1;
    if (occurrences > maximumCoalescedOccurrences) {
      throw new Error("trigger is too far behind to coalesce safely");
    }
  }

  return {
    due: true as const,
    scheduledFor: input.scheduledFor,
    nextTriggerAt: cursor,
    skippedOccurrences: Math.max(occurrences - 1, 0),
  };
};
