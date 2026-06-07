import { randomUUID } from "node:crypto";

import { type TenantIdentity, createSmokeContext, runSmoke, sleep } from "./smoke-utils";

type EventSnapshot = {
  id?: string;
  type?: string;
};

const { baseUrl, headersFor, createThread } = createSmokeContext({
  pollTimeoutDefault: 45_000,
});

const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? 45_000);
const suffix = randomUUID();

const tenantA: TenantIdentity = {
  userId: `stream-tenant-a-user-${suffix}`,
  workspaceId: `stream-tenant-a-workspace-${suffix}`,
  agentId: `stream-tenant-a-agent-${suffix}`,
};

const startRunStream = (identity: TenantIdentity, threadId: string) =>
  fetch(`${baseUrl}/langgraph/threads/${encodeURIComponent(threadId)}/runs/stream`, {
    method: "POST",
    headers: headersFor(identity),
    body: JSON.stringify({
      assistant_id: "agent",
      input: {
        messages: [
          {
            role: "user",
            content: "Say one short sentence confirming the event stream is live.",
          },
        ],
      },
      stream_mode: ["messages"],
    }),
  });

const parseSseBlocks = (raw: string) =>
  raw
    .split(/\r?\n\r?\n/)
    .map((block) => {
      const event = block
        .split(/\r?\n/)
        .find((line) => line.startsWith("event: "))
        ?.slice("event: ".length)
        .trim();
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice("data: ".length))
        .join("\n");
      return { event, data };
    })
    .filter((block) => block.event || block.data);

const collectStreamEvents = async (identity: TenantIdentity, expectedTypes: string[]) => {
  const seen = new Set<string>();
  const events: EventSnapshot[] = [];
  const decoder = new TextDecoder();
  const startedAt = Date.now();
  let afterEventId: string | undefined;

  while (Date.now() - startedAt < timeoutMs) {
    const controller = new AbortController();
    const streamUrl = new URL(`${baseUrl}/events/stream`);
    if (afterEventId) streamUrl.searchParams.set("after", afterEventId);
    const response = await fetch(streamUrl, {
      headers: {
        ...headersFor(identity),
        accept: "text/event-stream",
      },
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`/events/stream failed with ${response.status}: ${await response.text()}`);
    }

    const reader = response.body.getReader();
    let buffer = "";

    try {
      while (Date.now() - startedAt < timeoutMs) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer = `${buffer}${decoder.decode(value, { stream: true })}`;
        const lastBoundary = buffer.lastIndexOf("\n\n");
        if (lastBoundary < 0) continue;

        const completeBuffer = buffer.slice(0, lastBoundary + 2);
        buffer = buffer.slice(lastBoundary + 2);
        const blocks = parseSseBlocks(completeBuffer);

        for (const block of blocks) {
          if (block.event !== "control-plane-event" || !block.data) continue;
          const parsed = JSON.parse(block.data) as EventSnapshot;
          events.push(parsed);
          if (parsed.id) afterEventId = parsed.id;
          if (parsed.type) seen.add(parsed.type);
        }

        if (expectedTypes.every((type) => seen.has(type))) return events;
      }
    } finally {
      controller.abort();
      await reader.cancel().catch(() => undefined);
    }
  }

  const missing = expectedTypes.filter((type) => !seen.has(type));
  throw new Error(`event stream is missing expected types: ${missing.join(", ")}`);
};

runSmoke("Cloudflare event stream smoke", async () => {
  console.log(`Smoking Cloudflare event stream at ${baseUrl}`);

  const expectedTypes = [
    "chat.session.created",
    "chat.thread.created",
    "chat.intent.created",
    "chat.policy.allowed",
    "chat.run.started",
    "chat.run.completed",
  ];
  const streamEventsPromise = collectStreamEvents(tenantA, expectedTypes);
  let threadId = "";
  let run: Response | null = null;
  let lastRunError = "";

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    threadId = await createThread(tenantA);
    const response = await startRunStream(tenantA, threadId);
    if (response.ok) {
      run = response;
      break;
    }

    const body = await response.text();
    lastRunError = `${response.status}: ${body}`;
    if (response.status !== 409 || !body.includes("already_running")) {
      throw new Error(`chat run stream failed with ${lastRunError}`);
    }

    await sleep(1_000);
  }

  if (!run) throw new Error(`chat run stream failed after retries with ${lastRunError}`);
  await run.text();
  const streamEvents = await streamEventsPromise;

  console.log(
    JSON.stringify(
      {
        threadId,
        streamEventCount: streamEvents.length,
        streamEventTypes: streamEvents.map((event) => event.type),
      },
      null,
      2,
    ),
  );
});

export {};
