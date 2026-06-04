type TenantIdentity = {
  userId: string;
  workspaceId: string;
  agentId: string;
};

type ThreadResponse = {
  thread_id?: string;
  error?: string;
};

type BoundarySnapshot = {
  ok?: boolean;
  latestIntent?: {
    id?: string;
    executionMode?: string;
    status?: string;
  } | null;
  latestPolicyDecision?: {
    id?: string;
    intentId?: string;
    decision?: string;
    reason?: string;
    executionMode?: string;
  } | null;
  latestRun?: {
    id?: string;
    intentId?: string;
    policyDecisionId?: string;
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

const tenant = {
  userId: "policy-tenant-user",
  workspaceId: "policy-tenant-workspace",
  agentId: "policy-tenant-agent",
} satisfies TenantIdentity;

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

const assertAllowedPolicy = (snapshot: BoundarySnapshot) => {
  if (
    snapshot.latestIntent?.status !== "allowed" ||
    snapshot.latestIntent.executionMode !== "ask" ||
    snapshot.latestPolicyDecision?.decision !== "allow" ||
    snapshot.latestPolicyDecision.executionMode !== "ask" ||
    snapshot.latestRun?.intentId !== snapshot.latestIntent.id ||
    snapshot.latestRun?.policyDecisionId !== snapshot.latestPolicyDecision.id
  ) {
    throw new Error("allowed chat run did not store matching intent, policy, and run records");
  }
};

const assertBlockedPolicy = (
  snapshot: BoundarySnapshot,
  input: { decisionStatus: string; executionMode?: string },
) => {
  if (
    snapshot.latestIntent?.status !== input.decisionStatus ||
    snapshot.latestPolicyDecision?.decision !== "block" ||
    (input.executionMode && snapshot.latestPolicyDecision.executionMode !== input.executionMode)
  ) {
    throw new Error("blocked chat run did not store matching intent and policy records");
  }
};

const assertResponseStatus = async (response: Response, status: number, label: string) => {
  if (response.status !== status) {
    throw new Error(
      `${label} expected ${status}, got ${response.status}: ${await response.text()}`,
    );
  }
  await response.text();
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

const main = async () => {
  console.log(`Smoking Cloudflare policy boundary at ${baseUrl}`);

  const allowed = await startAcceptedStreamOnNewThread(
    tenant,
    streamBody({
      content: "Say one short sentence confirming the policy boundary is live.",
    }),
    "allowed stream",
  );
  await allowed.response.text();
  const completed = await waitForCompletedRun(tenant, allowed.threadId);
  if (!completed.latestRun?.upstreamRunId) {
    throw new Error("allowed policy run is missing upstream LangGraph run id");
  }
  assertAllowedPolicy(completed);

  const executeBlock = await startStream(
    tenant,
    allowed.threadId,
    streamBody({
      content: "Attempt execute mode.",
      executionMode: "execute",
    }),
  );
  await assertResponseStatus(executeBlock, 403, "execute-mode policy block");
  const executeBlockedSnapshot = await getBoundarySnapshot(tenant, allowed.threadId);
  assertBlockedPolicy(executeBlockedSnapshot, {
    decisionStatus: "blocked",
    executionMode: "execute",
  });

  const firstConcurrent = await startAcceptedStreamOnNewThread(
    tenant,
    streamBody({
      content: "Reply with three short sentences to keep this run briefly open.",
    }),
    "first concurrent stream",
  );

  const duplicateConcurrent = await startStream(
    tenant,
    firstConcurrent.threadId,
    streamBody({
      content: "Attempt a second run on the same thread.",
    }),
  );
  await assertResponseStatus(duplicateConcurrent, 409, "same-thread running policy block");
  const duplicateBlockedSnapshot = await getBoundarySnapshot(tenant, firstConcurrent.threadId);
  assertBlockedPolicy(duplicateBlockedSnapshot, {
    decisionStatus: "blocked",
    executionMode: "ask",
  });

  await firstConcurrent.response.text();
  await waitForCompletedRun(tenant, firstConcurrent.threadId);

  console.log("Cloudflare policy boundary smoke passed");
  console.log(
    JSON.stringify(
      {
        allowedThreadId: allowed.threadId,
        allowedRunId: completed.latestRun.id,
        allowedIntentId: completed.latestIntent?.id,
        executeBlockPolicyId: executeBlockedSnapshot.latestPolicyDecision?.id,
        concurrentThreadId: firstConcurrent.threadId,
        duplicateBlockPolicyId: duplicateBlockedSnapshot.latestPolicyDecision?.id,
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
