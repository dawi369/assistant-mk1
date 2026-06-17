import { type TenantIdentity, createSmokeContext, runSmoke } from "./smoke-utils";

type ChatThreadSummary = {
  threadId?: string;
  status?: string;
  title?: string;
  isActive?: boolean;
  latestRunStatus?: string;
};

type ChatSessionResponse = {
  ok?: boolean;
  activeThread?: ChatThreadSummary | null;
  threads?: ChatThreadSummary[];
  connection?: {
    threadId?: string;
    token?: string;
  };
  transition?: {
    type?: "initial" | "create" | "activate" | "rename" | "archive" | "restore" | "delete";
  };
  error?: string;
};

type ChatThreadsResponse = {
  ok?: boolean;
  threads?: ChatThreadSummary[];
  error?: string;
};

type EventSnapshot = {
  id?: string;
  type?: string;
  summary?: string;
  targetType?: string;
  targetId?: string;
  data?: Record<string, unknown>;
};

type EventsResponse = {
  ok?: boolean;
  events?: EventSnapshot[];
  error?: string;
};

const { baseUrl, suffix, readJson, assertStatus, startStream, streamBody } = createSmokeContext();

const owner: TenantIdentity = {
  userId: `chat-lifecycle-owner-${suffix}`,
  accountId: `workos-org:chat-lifecycle-org-${suffix}`,
  accountSource: "workos-organization",
  email: `chat-lifecycle-owner-${suffix}@example.com`,
  role: "owner",
  roles: ["owner"],
};

const otherTenant: TenantIdentity = {
  userId: `chat-lifecycle-other-${suffix}`,
  accountId: `workos-org:chat-lifecycle-other-org-${suffix}`,
  accountSource: "workos-organization",
  email: `chat-lifecycle-other-${suffix}@example.com`,
  role: "owner",
  roles: ["owner"],
};

const getSession = (identity: TenantIdentity) =>
  readJson<ChatSessionResponse>("/chat/session", identity);

const listThreads = (identity: TenantIdentity, status: "active" | "archived") =>
  readJson<ChatThreadsResponse>(`/chat/session/threads?status=${status}`, identity);

const latestEvents = (identity: TenantIdentity, limit = 100) =>
  readJson<EventsResponse>(`/events/latest?limit=${limit}`, identity);

const eventsAfter = (identity: TenantIdentity, eventId: string, limit = 100) =>
  readJson<EventsResponse>(`/events?after=${encodeURIComponent(eventId)}&limit=${limit}`, identity);

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

const updateThread = (
  identity: TenantIdentity,
  threadId: string,
  body: { title?: string; status?: "active" | "archived" | "deleted" },
) =>
  readJson<ChatSessionResponse>(`/chat/session/threads/${encodeURIComponent(threadId)}`, identity, {
    method: "PATCH",
    body: JSON.stringify(body),
  });

const requireThreadId = (response: ChatSessionResponse, label: string) => {
  const threadId = response.activeThread?.threadId;
  if (!response.ok || !threadId || !response.connection?.token) {
    throw new Error(response.error ?? `${label} did not include an active thread connection`);
  }
  return threadId;
};

const assertListIncludes = (
  response: ChatThreadsResponse,
  threadId: string,
  label: string,
  expected = true,
) => {
  const hasThread = response.threads?.some((thread) => thread.threadId === threadId) ?? false;
  if (hasThread !== expected) {
    throw new Error(`${label} ${expected ? "did not include" : "included"} ${threadId}`);
  }
};

const requireEventTypes = (events: EventSnapshot[], expectedTypes: string[]) => {
  const eventTypes = new Set(events.map((event) => event.type));
  for (const type of expectedTypes) {
    if (!eventTypes.has(type)) throw new Error(`missing lifecycle event ${type}`);
  }
};

const assertEventDataIsRedacted = (events: EventSnapshot[]) => {
  const raw = JSON.stringify(events.filter((event) => event.type?.startsWith("session.thread.")));
  if (/token|secret|rawPrompt|messages|providerPayload/i.test(raw)) {
    throw new Error("lifecycle event feed included disallowed sensitive fields");
  }
};

runSmoke("Cloudflare chat session lifecycle smoke", async () => {
  console.log(`Smoking Cloudflare chat session lifecycle at ${baseUrl}`);

  const initial = await getSession(owner);
  const threadA = requireThreadId(initial, "initial session");

  const created = await createThread(owner);
  const threadB = requireThreadId(created, "created session");
  if (threadB === threadA || created.transition?.type !== "create") {
    throw new Error("thread creation did not activate a distinct thread");
  }

  const activated = await activateThread(owner, threadA);
  if (activated.activeThread?.threadId !== threadA || activated.transition?.type !== "activate") {
    throw new Error("thread activation did not restore thread A");
  }

  const renamed = await updateThread(owner, threadB, { title: "Lifecycle smoke renamed" });
  if (renamed.transition?.type !== "rename") {
    throw new Error("thread rename did not return a rename transition");
  }
  const renamedList = await listThreads(owner, "active");
  const renamedThread = renamedList.threads?.find((thread) => thread.threadId === threadB);
  if (renamedThread?.title !== "Lifecycle smoke renamed") {
    throw new Error("renamed thread title was not visible in active list");
  }

  const archived = await updateThread(owner, threadB, { status: "archived" });
  if (archived.transition?.type !== "archive") {
    throw new Error("archive did not return an archive transition");
  }
  const activeAfterArchive = await listThreads(owner, "active");
  const archivedAfterArchive = await listThreads(owner, "archived");
  assertListIncludes(activeAfterArchive, threadB, "active list after archive", false);
  assertListIncludes(archivedAfterArchive, threadB, "archived list after archive");

  const restored = await updateThread(owner, threadB, { status: "active" });
  if (restored.transition?.type !== "restore") {
    throw new Error("restore did not return a restore transition");
  }
  assertListIncludes(await listThreads(owner, "active"), threadB, "active list after restore");

  await assertStatus(`/chat/session/threads/${encodeURIComponent(threadB)}`, otherTenant, 404, {
    method: "PATCH",
    body: JSON.stringify({ title: "cross tenant rename" }),
  });

  const runningThread = requireThreadId(await createThread(owner), "running thread session");
  const runningResponse = await startStream(
    owner,
    runningThread,
    streamBody({
      content: "Keep this run open for lifecycle blocking smoke.",
      executionMode: "ask",
    }),
  );
  if (!runningResponse.ok) {
    throw new Error(
      `running stream failed with ${runningResponse.status}: ${await runningResponse.text()}`,
    );
  }
  try {
    await assertStatus(`/chat/session/threads/${encodeURIComponent(runningThread)}`, owner, 409, {
      method: "PATCH",
      body: JSON.stringify({ status: "archived" }),
    });
    await assertStatus(`/chat/session/threads/${encodeURIComponent(runningThread)}`, owner, 409, {
      method: "PATCH",
      body: JSON.stringify({ status: "deleted" }),
    });
  } finally {
    await runningResponse.body?.cancel().catch(() => undefined);
  }

  const deleted = await updateThread(owner, threadB, { status: "deleted" });
  if (deleted.transition?.type !== "delete") {
    throw new Error("delete did not return a delete transition");
  }
  assertListIncludes(
    await listThreads(owner, "active"),
    threadB,
    "active list after delete",
    false,
  );
  assertListIncludes(
    await listThreads(owner, "archived"),
    threadB,
    "archived list after delete",
    false,
  );

  const events = (await latestEvents(owner)).events ?? [];
  requireEventTypes(events, [
    "session.thread.created",
    "session.thread.activated",
    "session.thread.renamed",
    "session.thread.archived",
    "session.thread.restored",
    "session.thread.deleted",
    "session.thread.blocked",
  ]);
  assertEventDataIsRedacted(events);

  const oldestEvent = events.at(-1);
  if (!oldestEvent?.id) throw new Error("event feed did not return event ids");
  const replayed = (await eventsAfter(owner, oldestEvent.id)).events ?? [];
  if (replayed.length === 0) throw new Error("event feed after cursor did not replay newer events");
  assertEventDataIsRedacted(replayed);

  const otherTenantEvents = (await latestEvents(otherTenant)).events ?? [];
  if (otherTenantEvents.length > 0) {
    throw new Error("cross-tenant event replay leaked lifecycle events");
  }

  console.log(
    JSON.stringify(
      {
        threadA,
        threadB,
        runningThread,
        finalActiveThread: deleted.activeThread?.threadId,
        replayedEvents: replayed.length,
      },
      null,
      2,
    ),
  );
});

export {};
