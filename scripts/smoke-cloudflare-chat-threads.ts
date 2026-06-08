import { type TenantIdentity, createSmokeContext, runSmoke } from "./smoke-utils";

type ChatThreadsResponse = {
  ok?: boolean;
  threads?: Array<{
    threadId?: string;
    title?: string;
    isActive?: boolean;
    messageCount?: number;
  }>;
};

type ChatThreadResponse = {
  ok?: boolean;
  thread?: {
    threadId?: string;
    title?: string;
    isActive?: boolean;
  } | null;
};

const { baseUrl, suffix, readJson, fetchRaw, assertStatus, createThread } = createSmokeContext();

const owner: TenantIdentity = {
  userId: `chat-threads-user-${suffix}`,
  accountId: `workos-org:chat-threads-org-${suffix}`,
  accountSource: "workos-organization",
  email: `chat-threads-${suffix}@example.com`,
  role: "owner",
  roles: ["owner"],
};

const otherTenant: TenantIdentity = {
  userId: `chat-threads-other-user-${suffix}`,
  accountId: `workos-org:chat-threads-other-org-${suffix}`,
  accountSource: "workos-organization",
  email: `chat-threads-other-${suffix}@example.com`,
  role: "owner",
  roles: ["owner"],
};

const getThreads = (identity: TenantIdentity) =>
  readJson<ChatThreadsResponse>("/chat/threads?limit=30", identity);

const getThread = (identity: TenantIdentity, threadId: string) =>
  readJson<ChatThreadResponse>(`/chat/threads/${encodeURIComponent(threadId)}`, identity);

const loadThreadState = async (identity: TenantIdentity, threadId: string) => {
  const response = await fetchRaw(
    `/langgraph/threads/${encodeURIComponent(threadId)}/state`,
    identity,
  );
  if (!response.ok) {
    throw new Error(`thread state load failed with ${response.status}: ${await response.text()}`);
  }
  await response.text();
};

const requireActiveThread = async (threadId: string, label: string) => {
  const threads = await getThreads(owner);
  const active = threads.threads?.find((thread) => thread.isActive);
  if (active?.threadId !== threadId) {
    throw new Error(
      `${label} expected active thread ${threadId}, got ${active?.threadId ?? "none"}`,
    );
  }
  if (!threads.threads?.some((thread) => thread.threadId === threadId)) {
    throw new Error(`${label} did not list expected thread ${threadId}`);
  }
  return threads;
};

runSmoke("Cloudflare chat threads smoke", async () => {
  console.log(`Smoking Cloudflare chat threads at ${baseUrl}`);

  const empty = await getThreads(owner);
  if (!empty.ok || (empty.threads?.length ?? 0) !== 0) {
    throw new Error(`empty tenant expected no threads, got ${empty.threads?.length ?? "none"}`);
  }

  const threadA = await createThread(owner);
  await requireActiveThread(threadA, "thread A creation");

  const threadB = await createThread(owner);
  const afterThreadB = await requireActiveThread(threadB, "thread B creation");
  if (!afterThreadB.threads?.some((thread) => thread.threadId === threadA)) {
    throw new Error("thread list dropped previous owned thread");
  }

  await loadThreadState(owner, threadA);
  await requireActiveThread(threadA, "thread A state load");

  const detail = await getThread(owner, threadA);
  if (!detail.ok || detail.thread?.threadId !== threadA) {
    throw new Error("thread detail did not return owned thread metadata");
  }
  if (!detail.thread.title) {
    throw new Error("thread detail did not include a title");
  }

  const otherList = await getThreads(otherTenant);
  if ((otherList.threads?.length ?? 0) !== 0) {
    throw new Error("cross-account list leaked owner threads");
  }
  await assertStatus(`/chat/threads/${encodeURIComponent(threadA)}`, otherTenant, 404);
  await assertStatus(`/chat/threads/${encodeURIComponent(threadB)}`, otherTenant, 404);

  console.log(
    JSON.stringify(
      {
        threadA,
        threadB,
        activeThreadId: threadA,
        listedThreads: afterThreadB.threads?.length ?? 0,
      },
      null,
      2,
    ),
  );
});

export {};
