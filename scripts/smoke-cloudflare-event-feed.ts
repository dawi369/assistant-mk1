import { randomUUID } from "node:crypto";

import { type TenantIdentity, createSmokeContext, runSmoke, sleep } from "./smoke-utils";

type EventSnapshot = {
  id?: string;
  type?: string;
  summary?: string;
  createdAt?: string;
};

type EventsResponse = {
  ok?: boolean;
  events?: EventSnapshot[];
  error?: string;
};

type BoundarySnapshot = {
  ok?: boolean;
  latestRun?: {
    id?: string;
    upstreamRunId?: string;
    status?: string;
  } | null;
  error?: string;
};

const {
  baseUrl,
  pollTimeoutMs,
  pollIntervalMs,
  readJson,
  streamBody,
  startStream,
  startAcceptedStreamOnNewThread,
} = createSmokeContext();

const suffix = randomUUID();

const tenants = {
  a: {
    userId: `event-tenant-a-user-${suffix}`,
    workspaceId: `event-tenant-a-workspace-${suffix}`,
    agentId: `event-tenant-a-agent-${suffix}`,
  },
  b: {
    userId: `event-tenant-b-user-${suffix}`,
    workspaceId: `event-tenant-b-workspace-${suffix}`,
    agentId: `event-tenant-b-agent-${suffix}`,
  },
} satisfies Record<string, TenantIdentity>;

const getBoundarySnapshot = (identity: TenantIdentity, threadId: string) =>
  readJson<BoundarySnapshot>(
    `/internal/chat-boundary/threads/${encodeURIComponent(threadId)}/snapshot`,
    identity,
  );

const getLatestEvents = (identity: TenantIdentity, limit = 100) =>
  readJson<EventsResponse>(`/events/latest?limit=${limit}`, identity);

const getEventsAfter = (identity: TenantIdentity, eventId: string, limit = 100) =>
  readJson<EventsResponse>(`/events?after=${encodeURIComponent(eventId)}&limit=${limit}`, identity);

const waitForCompletedRun = async (identity: TenantIdentity, threadId: string) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < pollTimeoutMs) {
    const snapshot = await getBoundarySnapshot(identity, threadId);
    if (snapshot.latestRun?.status === "completed") return snapshot;
    if (snapshot.latestRun?.status === "failed") {
      throw new Error(`tracked chat run failed: ${snapshot.latestRun.id ?? "unknown"}`);
    }

    await sleep(pollIntervalMs);
  }

  throw new Error(`chat run tracking did not complete within ${pollTimeoutMs}ms`);
};

const requireEventTypes = (events: EventSnapshot[], expectedTypes: string[]) => {
  const eventTypes = new Set(events.map((event) => event.type));
  const missing = expectedTypes.filter((type) => !eventTypes.has(type));
  if (missing.length > 0) {
    throw new Error(`event feed is missing expected types: ${missing.join(", ")}`);
  }
};

runSmoke("Cloudflare event feed smoke", async () => {
  console.log(`Smoking Cloudflare event feed at ${baseUrl}`);

  const allowed = await startAcceptedStreamOnNewThread(
    tenants.a,
    streamBody({
      content: "Say one short sentence confirming the event feed is live.",
    }),
    "allowed event-feed stream",
  );
  await allowed.response.text();
  const completed = await waitForCompletedRun(tenants.a, allowed.threadId);
  if (!completed.latestRun?.id) throw new Error("allowed event-feed run is missing run id");

  const executeBlock = await startStream(
    tenants.a,
    allowed.threadId,
    streamBody({
      content: "Attempt execute mode for event-feed smoke.",
      executionMode: "execute",
    }),
  );
  if (executeBlock.status !== 403) {
    throw new Error(`execute policy block expected 403, got ${executeBlock.status}`);
  }
  await executeBlock.text();

  const tenantAEvents = (await getLatestEvents(tenants.a)).events ?? [];
  requireEventTypes(tenantAEvents, [
    "chat.session.created",
    "chat.thread.created",
    "chat.intent.created",
    "chat.policy.allowed",
    "chat.policy.blocked",
    "chat.run.started",
    "chat.run.completed",
  ]);

  const oldestTenantAEvent = tenantAEvents.at(-1);
  if (!oldestTenantAEvent?.id) throw new Error("event feed did not return event ids");
  const afterEvents = (await getEventsAfter(tenants.a, oldestTenantAEvent.id)).events ?? [];
  if (afterEvents.length === 0) {
    throw new Error("event feed after cursor did not return newer tenant events");
  }

  const tenantBEvents = (await getLatestEvents(tenants.b)).events ?? [];
  if (tenantBEvents.length > 0) {
    throw new Error("tenant B could read tenant A event feed entries");
  }

  console.log(
    JSON.stringify(
      {
        threadId: allowed.threadId,
        eventCount: tenantAEvents.length,
        afterEventCount: afterEvents.length,
        latestEventTypes: tenantAEvents.map((event) => event.type).slice(0, 8),
      },
      null,
      2,
    ),
  );
});

export {};
