import { type TenantIdentity, createSmokeContext, runSmoke } from "./smoke-utils";

type ChatRuntimeSummaryResponse = {
  ok?: boolean;
  chatRuntime?: {
    state?: string;
    latestSession?: {
      sessionId?: string;
      activeThreadId?: string;
    } | null;
    latestThread?: {
      threadId?: string;
    } | null;
    latestRun?: {
      id?: string;
      status?: string;
    } | null;
  };
};

type BoundarySnapshot = {
  ok?: boolean;
  latestThread?: {
    threadId?: string;
  } | null;
  error?: string;
};

const { baseUrl, suffix, readJson, createThread, assertStatus } = createSmokeContext();

const owner: TenantIdentity = {
  userId: `chat-reset-user-${suffix}`,
  accountId: `workos-org:chat-reset-org-${suffix}`,
  accountSource: "workos-organization",
  email: `chat-reset-${suffix}@example.com`,
  role: "owner",
  roles: ["owner"],
};

const otherTenant: TenantIdentity = {
  userId: `chat-reset-other-user-${suffix}`,
  accountId: `workos-org:chat-reset-other-org-${suffix}`,
  accountSource: "workos-organization",
  email: `chat-reset-other-${suffix}@example.com`,
  role: "owner",
  roles: ["owner"],
};

const getRuntimeSummary = (identity: TenantIdentity) =>
  readJson<ChatRuntimeSummaryResponse>("/chat/runtime-summary", identity);

const getBoundarySnapshot = (identity: TenantIdentity, threadId: string) =>
  readJson<BoundarySnapshot>(
    `/internal/chat-boundary/threads/${encodeURIComponent(threadId)}/snapshot`,
    identity,
  );

const assertActiveThread = async (threadId: string, label: string) => {
  const summary = await getRuntimeSummary(owner);
  if (summary.chatRuntime?.state !== "thread_ready") {
    throw new Error(`${label} expected thread_ready, got ${summary.chatRuntime?.state ?? "none"}`);
  }
  if (summary.chatRuntime.latestSession?.activeThreadId !== threadId) {
    throw new Error(
      `${label} expected active_thread_id ${threadId}, got ${
        summary.chatRuntime.latestSession?.activeThreadId ?? "none"
      }`,
    );
  }
  if (summary.chatRuntime.latestThread?.threadId !== threadId) {
    throw new Error(`${label} did not return the active thread`);
  }
  if (summary.chatRuntime.latestRun) {
    throw new Error(`${label} expected no latest run for a fresh thread`);
  }
};

runSmoke("Cloudflare chat reset smoke", async () => {
  console.log(`Smoking Cloudflare chat reset at ${baseUrl}`);

  const initialSummary = await getRuntimeSummary(owner);
  if (initialSummary.chatRuntime?.state !== "no_session") {
    throw new Error(`empty owner expected no_session, got ${initialSummary.chatRuntime?.state}`);
  }

  const firstThreadId = await createThread(owner);
  await assertActiveThread(firstThreadId, "first thread");

  const secondThreadId = await createThread(owner);
  if (secondThreadId === firstThreadId) {
    throw new Error("new chat returned the same thread id");
  }
  await assertActiveThread(secondThreadId, "second thread");

  const oldSnapshot = await getBoundarySnapshot(owner, firstThreadId);
  if (!oldSnapshot.ok) throw new Error(oldSnapshot.error ?? "owner could not read old thread");

  await assertStatus(
    `/internal/chat-boundary/threads/${encodeURIComponent(firstThreadId)}/snapshot`,
    otherTenant,
    404,
  );
  await assertStatus(
    `/internal/chat-boundary/threads/${encodeURIComponent(secondThreadId)}/snapshot`,
    otherTenant,
    404,
  );

  console.log(
    JSON.stringify(
      {
        firstThreadId,
        secondThreadId,
      },
      null,
      2,
    ),
  );
});

export {};
