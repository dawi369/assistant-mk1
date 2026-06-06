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
  thread?: {
    threadId?: string;
    scope?: {
      userId?: string;
      workspaceId?: string;
    };
  };
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
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const tenants = {
  a: {
    userId: `chat-tenant-a-user-${suffix}`,
    workspaceId: `chat-tenant-a-workspace-${suffix}`,
    agentId: `chat-tenant-a-agent-${suffix}`,
  },
  b: {
    userId: `chat-tenant-b-user-${suffix}`,
    workspaceId: `chat-tenant-b-workspace-${suffix}`,
    agentId: `chat-tenant-b-agent-${suffix}`,
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

const assertThreadVisible = async (identity: TenantIdentity, threadId: string) => {
  const snapshot = await getBoundarySnapshot(identity, threadId);
  assertBoundaryScope(snapshot, identity, threadId);
};

const assertThreadHidden = async (identity: TenantIdentity, threadId: string, label: string) => {
  const response = await fetch(
    `${baseUrl}/langgraph/threads/${encodeURIComponent(threadId)}/state`,
    {
      headers: headersFor(identity),
    },
  );
  if (response.status !== 404) {
    throw new Error(
      `${label} expected cross-tenant thread read to return 404, got ${response.status}`,
    );
  }
};

const getBoundarySnapshot = (identity: TenantIdentity, threadId: string) =>
  readJson<BoundarySnapshot>(
    `/internal/chat-boundary/threads/${encodeURIComponent(threadId)}/snapshot`,
    identity,
  );

const assertBoundaryScope = (
  snapshot: BoundarySnapshot,
  identity: TenantIdentity,
  threadId: string,
) => {
  if (
    !snapshot.ok ||
    snapshot.thread?.threadId !== threadId ||
    snapshot.thread.scope?.userId !== identity.userId ||
    snapshot.thread.scope.workspaceId !== identity.workspaceId
  ) {
    throw new Error("chat boundary snapshot returned the wrong tenant/thread ownership");
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const runStreamOnNewThread = async (identity: TenantIdentity, label: string) => {
  let lastError = "";

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const threadId = await createThread(identity);
    const response = await fetch(
      `${baseUrl}/langgraph/threads/${encodeURIComponent(threadId)}/runs/stream`,
      {
        method: "POST",
        headers: headersFor(identity),
        body: JSON.stringify({
          assistant_id: "agent",
          input: {
            messages: [
              {
                role: "user",
                content: "Say one short sentence confirming the chat boundary is live.",
              },
            ],
          },
          stream_mode: ["messages"],
        }),
      },
    );

    if (response.ok) {
      await response.text();
      return threadId;
    }

    const responseBody = await response.text();
    lastError = `${response.status}: ${responseBody}`;
    if (response.status !== 422 || !responseBody.includes("Thread is already running")) {
      throw new Error(`${label} failed with ${lastError}`);
    }

    await sleep(1_000);
  }

  throw new Error(`${label} failed after retries with ${lastError}`);
};

const waitForTrackedRun = async (identity: TenantIdentity, threadId: string) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < pollTimeoutMs) {
    const snapshot = await getBoundarySnapshot(identity, threadId);
    assertBoundaryScope(snapshot, identity, threadId);

    if (snapshot.latestRun?.status === "completed") return snapshot;
    if (snapshot.latestRun?.status === "failed") {
      throw new Error(`tracked chat run failed: ${snapshot.latestRun.id ?? "unknown"}`);
    }

    await sleep(pollIntervalMs);
  }

  throw new Error(`chat run tracking did not complete within ${pollTimeoutMs}ms`);
};

const main = async () => {
  console.log(`Smoking Cloudflare chat boundary at ${baseUrl}`);

  const threadA = await createThread(tenants.a);
  const threadB = await createThread(tenants.b);

  await assertThreadVisible(tenants.a, threadA);
  await assertThreadVisible(tenants.b, threadB);
  await assertThreadHidden(tenants.a, threadB, "tenant A");
  await assertThreadHidden(tenants.b, threadA, "tenant B");

  const initialSnapshot = await getBoundarySnapshot(tenants.a, threadA);
  assertBoundaryScope(initialSnapshot, tenants.a, threadA);

  const runThreadA = await runStreamOnNewThread(tenants.a, "chat boundary stream");
  const completedSnapshot = await waitForTrackedRun(tenants.a, runThreadA);
  const completedRunId = completedSnapshot.latestRun?.id;
  if (!completedRunId) throw new Error("tracked chat run is missing run id");

  console.log("Cloudflare chat boundary smoke passed");
  console.log(
    JSON.stringify(
      {
        tenantAThreadId: threadA,
        tenantBThreadId: threadB,
        runThreadId: runThreadA,
        trackedRunId: completedRunId,
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
