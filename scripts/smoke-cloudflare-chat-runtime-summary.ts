import { type TenantIdentity, createSmokeContext, runSmoke, sleep } from "./smoke-utils";

type ChatRuntimeSummaryResponse = {
  ok?: boolean;
  chatRuntime?: {
    state?: string;
    latestSession?: {
      sessionId?: string;
      activeThreadId?: string;
      status?: string;
    } | null;
    latestThread?: {
      threadId?: string;
      status?: string;
    } | null;
    latestRun?: {
      id?: string;
      threadId?: string;
      upstreamRunId?: string;
      status?: string;
      error?: string;
    } | null;
    latestIntent?: {
      id?: string;
      status?: string;
    } | null;
    latestPolicyDecision?: {
      id?: string;
      decision?: string;
      reason?: string;
    } | null;
    events?: Array<{
      id?: string;
      type?: string;
      targetId?: string;
    }>;
    failure?: {
      message?: string;
      status?: string;
      targetId?: string;
    } | null;
  };
  error?: string;
};

const { baseUrl, suffix, pollTimeoutMs, pollIntervalMs, headersFor, readJson, createThread } =
  createSmokeContext();

const tenantA: TenantIdentity = {
  userId: `chat-runtime-user-a-${suffix}`,
  accountId: `workos-org:chat-runtime-org-a-${suffix}`,
  accountSource: "workos-organization",
  email: `chat-runtime-a-${suffix}@example.com`,
  role: "owner",
  roles: ["owner"],
};

const tenantB: TenantIdentity = {
  userId: `chat-runtime-user-b-${suffix}`,
  accountId: `workos-org:chat-runtime-org-b-${suffix}`,
  accountSource: "workos-organization",
  email: `chat-runtime-b-${suffix}@example.com`,
  role: "owner",
  roles: ["owner"],
};

const getRuntimeSummary = (identity: TenantIdentity) =>
  readJson<ChatRuntimeSummaryResponse>("/chat/runtime-summary", identity);

const requireSummaryState = async (identity: TenantIdentity, state: string, label: string) => {
  const summary = await getRuntimeSummary(identity);
  if (!summary.ok || summary.chatRuntime?.state !== state) {
    throw new Error(
      `${label} expected chat runtime state ${state}, got ${summary.chatRuntime?.state ?? "none"}`,
    );
  }
  return summary;
};

const waitForRuntimeState = async (
  identity: TenantIdentity,
  expectedState: string,
  label: string,
) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < pollTimeoutMs) {
    const summary = await getRuntimeSummary(identity);
    if (summary.chatRuntime?.state === expectedState) return summary;
    await sleep(pollIntervalMs);
  }

  throw new Error(`${label} did not reach ${expectedState} within ${pollTimeoutMs}ms`);
};

const runStream = async (identity: TenantIdentity, threadId: string, assistantId = "agent") => {
  const response = await fetch(
    `${baseUrl}/langgraph/threads/${encodeURIComponent(threadId)}/runs/stream`,
    {
      method: "POST",
      headers: headersFor(identity),
      body: JSON.stringify({
        assistant_id: assistantId,
        input: {
          messages: [
            {
              role: "user",
              content: "Say one short sentence confirming the chat runtime summary is live.",
            },
          ],
        },
        stream_mode: ["messages"],
      }),
    },
  );
  const body = await response.text();
  return { response, body };
};

const assertThreadHidden = async (identity: TenantIdentity, threadId: string) => {
  const response = await fetch(
    `${baseUrl}/internal/chat-boundary/threads/${encodeURIComponent(threadId)}/snapshot`,
    {
      headers: headersFor(identity),
    },
  );
  if (response.status !== 404) {
    const body = await response.text();
    throw new Error(`cross-workspace snapshot expected 404, got ${response.status}: ${body}`);
  }
};

runSmoke("Cloudflare chat runtime summary smoke", async () => {
  console.log(`Smoking Cloudflare chat runtime summary at ${baseUrl}`);

  await requireSummaryState(tenantA, "no_session", "empty tenant");

  const threadId = await createThread(tenantA);
  const readySummary = await requireSummaryState(tenantA, "thread_ready", "created thread");
  if (readySummary.chatRuntime?.latestThread?.threadId !== threadId) {
    throw new Error("runtime summary did not return the owned latest thread");
  }

  const tenantBSummary = await requireSummaryState(tenantB, "no_session", "cross account tenant");
  if (tenantBSummary.chatRuntime?.latestThread?.threadId === threadId) {
    throw new Error("cross-account summary leaked tenant A thread");
  }
  await assertThreadHidden(tenantB, threadId);

  const runResult = await runStream(tenantA, threadId);
  if (!runResult.response.ok) {
    throw new Error(`valid chat run failed with ${runResult.response.status}: ${runResult.body}`);
  }

  const completedSummary = await waitForRuntimeState(tenantA, "completed", "valid chat run");
  if (!completedSummary.chatRuntime?.latestRun?.id) {
    throw new Error("completed runtime summary did not include a chat run");
  }
  if (!completedSummary.chatRuntime.latestIntent?.id) {
    throw new Error("completed runtime summary did not include a chat intent");
  }
  if (!completedSummary.chatRuntime.latestPolicyDecision?.id) {
    throw new Error("completed runtime summary did not include a policy decision");
  }
  if (!completedSummary.chatRuntime.events?.some((event) => event.type?.startsWith("chat."))) {
    throw new Error("completed runtime summary did not include chat events");
  }

  const failureThreadId = await createThread(tenantA);
  const failedRun = await runStream(tenantA, failureThreadId, "__missing_assistant__");
  if (failedRun.response.ok) {
    throw new Error("invalid assistant run unexpectedly succeeded");
  }

  const failedSummary = await waitForRuntimeState(tenantA, "failed", "invalid assistant run");
  if (!failedSummary.chatRuntime?.failure?.message) {
    throw new Error("failed runtime summary did not include failure details");
  }

  console.log(
    JSON.stringify(
      {
        threadId,
        completedRunId: completedSummary.chatRuntime.latestRun.id,
        failureThreadId,
        failedRunId: failedSummary.chatRuntime.latestRun?.id,
        failedRunStatus: failedSummary.chatRuntime.latestRun?.status,
      },
      null,
      2,
    ),
  );
});

export {};
