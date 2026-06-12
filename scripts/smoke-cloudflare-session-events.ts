import { type TenantIdentity, createSmokeContext, runSmoke } from "./smoke-utils";

type ChatSessionResponse = {
  ok?: boolean;
  revision?: number;
  activeThread?: { threadId?: string; agentId?: string } | null;
  threads?: Array<{ threadId?: string; isActive?: boolean }>;
  error?: string;
};

type WorkbenchSessionEvent = {
  id: string;
  type: string;
  revision?: number;
  createdAt: string;
  data: Record<string, unknown>;
};

const { baseUrl, suffix, token, readJson, fetchRaw } = createSmokeContext();

const owner: TenantIdentity = {
  userId: `session-events-owner-${suffix}`,
  accountId: `workos-org:session-events-org-${suffix}`,
  accountSource: "workos-organization",
  email: `session-events-owner-${suffix}@example.com`,
  role: "owner",
  roles: ["owner"],
};

const otherTenant: TenantIdentity = {
  userId: `session-events-other-${suffix}`,
  accountId: `workos-org:session-events-other-org-${suffix}`,
  accountSource: "workos-organization",
  email: `session-events-other-${suffix}@example.com`,
  role: "owner",
  roles: ["owner"],
};

class SseReader {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private buffer = "";
  private decoder = new TextDecoder();

  constructor(readonly response: Response) {
    if (!response.body) throw new Error("SSE response did not include a body");
    this.reader = response.body.getReader();
  }

  async close() {
    await this.reader.cancel().catch(() => undefined);
  }

  async next(timeoutMs = 5_000): Promise<WorkbenchSessionEvent | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const parsed = this.readBufferedEvent();
      if (parsed) return parsed;

      const remainingMs = Math.max(1, deadline - Date.now());
      const result = await Promise.race([
        this.reader.read(),
        new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), remainingMs)),
      ]);
      if (result === "timeout") return null;
      if (result.done) return null;
      if (result.value) this.buffer += this.decoder.decode(result.value, { stream: true });
    }
    return null;
  }

  private readBufferedEvent(): WorkbenchSessionEvent | null {
    const boundary = this.buffer.indexOf("\n\n");
    if (boundary === -1) return null;

    const raw = this.buffer.slice(0, boundary);
    this.buffer = this.buffer.slice(boundary + 2);
    if (!raw.trim() || raw.startsWith(":")) return this.readBufferedEvent();

    let data = "";
    for (const line of raw.split("\n")) {
      if (line.startsWith("data:")) data += line.slice("data:".length).trimStart();
    }
    if (!data) return this.readBufferedEvent();
    return JSON.parse(data) as WorkbenchSessionEvent;
  }
}

const openStream = async (identity: TenantIdentity) => {
  const response = await fetchRaw("/chat/session/stream", identity, {
    headers: { accept: "text/event-stream" },
  });
  if (!response.ok) {
    throw new Error(`session stream failed with ${response.status}: ${await response.text()}`);
  }
  return new SseReader(response);
};

const waitForEvent = async (stream: SseReader, type: string, label: string, timeoutMs = 8_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const event = await stream.next(Math.max(1, deadline - Date.now()));
    if (!event) break;
    if (event.type === type) return event;
  }
  throw new Error(`Timed out waiting for ${label} (${type})`);
};

const createThread = (identity: TenantIdentity) =>
  readJson<ChatSessionResponse>("/chat/session/threads", identity, {
    method: "POST",
    body: "{}",
  });

const activateThread = (identity: TenantIdentity, threadId: string) =>
  readJson<ChatSessionResponse>(
    `/chat/session/threads/${encodeURIComponent(threadId)}/activate`,
    identity,
    { method: "POST", body: "{}" },
  );

runSmoke("Cloudflare session events smoke", async () => {
  console.log(`Smoking Cloudflare session events at ${baseUrl}`);

  const ownerStream = await openStream(owner);
  const otherStream = await openStream(otherTenant);

  try {
    const ownerSnapshot = await waitForEvent(ownerStream, "session.snapshot", "owner snapshot");
    const otherSnapshot = await waitForEvent(otherStream, "session.snapshot", "other snapshot");
    if (!ownerSnapshot.revision || !otherSnapshot.revision) {
      throw new Error("session.snapshot did not include coordinator revision");
    }

    const threadA = (ownerSnapshot.data.activeThread as { threadId?: string } | undefined)
      ?.threadId;
    if (!threadA) throw new Error("session.snapshot did not include an active thread");

    const created = await createThread(owner);
    const threadB = created.activeThread?.threadId;
    if (!threadB || threadB === threadA) throw new Error("thread create did not return a new id");
    const createdEvent = await waitForEvent(
      ownerStream,
      "session.thread.created",
      "thread created event",
    );
    if (
      (createdEvent.data.activeThread as { threadId?: string } | undefined)?.threadId !== threadB
    ) {
      throw new Error("session.thread.created did not carry the created active thread");
    }

    await readJson<ChatSessionResponse>("/chat/session?refresh=threads", owner);
    await waitForEvent(ownerStream, "session.threads.refreshed", "threads refreshed event");

    await activateThread(owner, threadA);
    const activatedEvent = await waitForEvent(
      ownerStream,
      "session.thread.activated",
      "thread activated event",
    );
    if (
      (activatedEvent.data.activeThread as { threadId?: string } | undefined)?.threadId !== threadA
    ) {
      throw new Error("session.thread.activated did not carry the restored active thread");
    }

    await readJson<unknown>("/tools/runs", owner, {
      method: "POST",
      body: JSON.stringify({
        toolName: "url.inspect",
        executionMode: "dry_run",
        input: { url: "https://example.com" },
      }),
    });
    const toolEvent = await waitForEvent(ownerStream, "tool.run.updated", "tool run updated event");
    if (toolEvent.data.toolName !== "url.inspect") {
      throw new Error("tool.run.updated did not identify url.inspect");
    }

    const unexpectedOtherEvent = await otherStream.next(750);
    if (
      unexpectedOtherEvent &&
      ["session.thread.created", "session.thread.activated", "tool.run.updated"].includes(
        unexpectedOtherEvent.type,
      )
    ) {
      throw new Error(`other tenant stream received owner event ${unexpectedOtherEvent.type}`);
    }

    const invalidResponse = await fetch(`${baseUrl}/chat/session/stream`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (invalidResponse.status < 400) {
      throw new Error(`invalid stream identity expected failure, got ${invalidResponse.status}`);
    }

    console.log(
      JSON.stringify(
        {
          threadA,
          threadB,
          createdEvent: createdEvent.type,
          activatedEvent: activatedEvent.type,
          toolEvent: toolEvent.type,
        },
        null,
        2,
      ),
    );
  } finally {
    await ownerStream.close();
    await otherStream.close();
  }
});

export {};
