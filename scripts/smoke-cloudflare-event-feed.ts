import { randomUUID } from "node:crypto";

type TenantIdentity = {
  userId: string;
  workspaceId: string;
  agentId: string;
};

type ThreadResponse = {
  thread_id?: string;
  error?: string;
};

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

const baseUrl = (process.env.CLOUDFLARE_CONTROL_PLANE_URL ?? "http://localhost:8787").replace(
  /\/$/,
  "",
);
const token = process.env.CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN ?? "local-dev-token";
const pollTimeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? 30_000);
const pollIntervalMs = Number(process.env.SMOKE_POLL_INTERVAL_MS ?? 400);
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

const headersFor = (identity: TenantIdentity) => ({
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
  "x-assistant-mk1-user-id": identity.userId,
  "x-assistant-mk1-workspace-id": identity.workspaceId,
  "x-assistant-mk1-agent-id": identity.agentId,
});

const readJson = async <T>(
  path: string,
  identity: TenantIdentity,
  init?: RequestInit,
): Promise<T> => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...headersFor(identity),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${init?.method ?? "GET"} ${path} failed with ${response.status}: ${body}`);
  }
  return (await response.json()) as T;
};

const createThread = async (identity: TenantIdentity) => {
  const thread = await readJson<ThreadResponse>("/langgraph/threads", identity, {
    method: "POST",
    body: "{}",
  });
  if (!thread.thread_id) throw new Error(thread.error ?? "thread_id missing");
  return thread.thread_id;
};

const streamBody = (input: { content: string; executionMode?: "ask" | "dry_run" | "execute" }) =>
  JSON.stringify({
    assistant_id: "agent",
    execution_mode: input.executionMode,
    input: {
      messages: [
        {
          role: "user",
          content: input.content,
        },
      ],
    },
    stream_mode: ["messages"],
  });

const startStream = (identity: TenantIdentity, threadId: string, body: string) =>
  fetch(`${baseUrl}/langgraph/threads/${encodeURIComponent(threadId)}/runs/stream`, {
    method: "POST",
    headers: headersFor(identity),
    body,
  });

const getBoundarySnapshot = (identity: TenantIdentity, threadId: string) =>
  readJson<BoundarySnapshot>(
    `/internal/chat-boundary/threads/${encodeURIComponent(threadId)}/snapshot`,
    identity,
  );

const getLatestEvents = (identity: TenantIdentity, limit = 100) =>
  readJson<EventsResponse>(`/events/latest?limit=${limit}`, identity);

const getEventsAfter = (identity: TenantIdentity, eventId: string, limit = 100) =>
  readJson<EventsResponse>(`/events?after=${encodeURIComponent(eventId)}&limit=${limit}`, identity);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

const startAcceptedStreamOnNewThread = async (
  identity: TenantIdentity,
  body: string,
  label: string,
) => {
  let lastError = "";

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const threadId = await createThread(identity);
    const response = await startStream(identity, threadId, body);
    if (response.ok) return { threadId, response };

    const responseBody = await response.text();
    lastError = `${response.status}: ${responseBody}`;
    if (response.status !== 422 || !responseBody.includes("Thread is already running")) {
      throw new Error(`${label} failed with ${lastError}`);
    }

    await sleep(1_000);
  }

  throw new Error(`${label} failed after retries with ${lastError}`);
};

const requireEventTypes = (events: EventSnapshot[], expectedTypes: string[]) => {
  const eventTypes = new Set(events.map((event) => event.type));
  const missing = expectedTypes.filter((type) => !eventTypes.has(type));
  if (missing.length > 0) {
    throw new Error(`event feed is missing expected types: ${missing.join(", ")}`);
  }
};

const main = async () => {
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
  if (!completed.latestRun?.upstreamRunId) {
    throw new Error("allowed event-feed run is missing upstream LangGraph run id");
  }

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

  console.log("Cloudflare event feed smoke passed");
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
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

export {};
