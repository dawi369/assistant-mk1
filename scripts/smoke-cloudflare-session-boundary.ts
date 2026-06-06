type TenantIdentity = {
  userId: string;
  workspaceId: string;
  agentId: string;
};

type SessionSnapshot = {
  sessionId?: string;
  activeThreadId?: string;
  scope?: {
    userId?: string;
    workspaceId?: string;
  };
};

type SessionResponse = {
  ok?: boolean;
  session?: SessionSnapshot | null;
  error?: string;
};

type ThreadResponse = {
  thread_id?: string;
  error?: string;
};

type BoundarySnapshot = {
  ok?: boolean;
  session?: SessionSnapshot | null;
  thread?: {
    threadId?: string;
    sessionId?: string;
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
    userId: `session-tenant-a-user-${suffix}`,
    workspaceId: `session-tenant-a-workspace-${suffix}`,
    agentId: `session-tenant-a-agent-${suffix}`,
  },
  b: {
    userId: `session-tenant-b-user-${suffix}`,
    workspaceId: `session-tenant-b-workspace-${suffix}`,
    agentId: `session-tenant-b-agent-${suffix}`,
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

const createSession = async (identity: TenantIdentity) => {
  const response = await readJson<SessionResponse>("/sessions", identity, {
    method: "POST",
    body: JSON.stringify({ metadata: { source: "session-boundary-smoke" } }),
  });
  if (!response.session?.sessionId) throw new Error(response.error ?? "sessionId missing");
  return response.session;
};

const latestSession = async (identity: TenantIdentity) => {
  const response = await readJson<SessionResponse>("/sessions/latest", identity);
  if (!response.session?.sessionId) throw new Error(response.error ?? "latest session missing");
  return response.session;
};

const createThread = async (identity: TenantIdentity) => {
  const thread = await readJson<ThreadResponse>("/langgraph/threads", identity, {
    method: "POST",
    body: "{}",
  });
  if (!thread.thread_id) throw new Error(thread.error ?? "thread_id missing");
  return thread.thread_id;
};

const assertSessionScope = (
  session: SessionSnapshot | null | undefined,
  identity: TenantIdentity,
  label: string,
) => {
  if (
    session?.scope?.userId !== identity.userId ||
    session.scope?.workspaceId !== identity.workspaceId
  ) {
    throw new Error(`${label} returned the wrong tenant scope`);
  }
};

const assertHidden = async (path: string, identity: TenantIdentity, label: string) => {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: headersFor(identity),
  });
  if (response.status !== 404) {
    throw new Error(`${label} expected 404, got ${response.status}`);
  }
};

const getBoundarySnapshot = (identity: TenantIdentity, threadId: string) =>
  readJson<BoundarySnapshot>(
    `/internal/chat-boundary/threads/${encodeURIComponent(threadId)}/snapshot`,
    identity,
  );

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
                content: "Say one short sentence confirming the session boundary is live.",
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

const waitForCompletedRun = async (
  identity: TenantIdentity,
  threadId: string,
  sessionId: string,
) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < pollTimeoutMs) {
    const snapshot = await getBoundarySnapshot(identity, threadId);
    if (
      snapshot.session?.sessionId !== sessionId ||
      snapshot.thread?.sessionId !== sessionId ||
      snapshot.thread.threadId !== threadId
    ) {
      throw new Error("boundary snapshot did not preserve session -> thread ownership");
    }
    assertSessionScope(snapshot.session, identity, "session boundary snapshot");

    if (snapshot.latestRun?.status === "completed") return snapshot;
    if (snapshot.latestRun?.status === "failed") {
      throw new Error(`tracked chat run failed: ${snapshot.latestRun.id ?? "unknown"}`);
    }

    await sleep(pollIntervalMs);
  }

  throw new Error(`chat run tracking did not complete within ${pollTimeoutMs}ms`);
};

const main = async () => {
  console.log(`Smoking Cloudflare session boundary at ${baseUrl}`);

  const sessionA = await createSession(tenants.a);
  const sessionB = await createSession(tenants.b);
  assertSessionScope(sessionA, tenants.a, "tenant A session");
  assertSessionScope(sessionB, tenants.b, "tenant B session");

  const latestA = await latestSession(tenants.a);
  const latestB = await latestSession(tenants.b);
  if (latestA.sessionId !== sessionA.sessionId) throw new Error("tenant A latest session drifted");
  if (latestB.sessionId !== sessionB.sessionId) throw new Error("tenant B latest session drifted");

  await assertHidden(`/sessions/${encodeURIComponent(sessionB.sessionId!)}`, tenants.a, "tenant A");
  await assertHidden(`/sessions/${encodeURIComponent(sessionA.sessionId!)}`, tenants.b, "tenant B");

  const threadA = await createThread(tenants.a);
  const attached = await getBoundarySnapshot(tenants.a, threadA);
  if (attached.session?.sessionId !== sessionA.sessionId) {
    throw new Error("thread was not attached to tenant A latest session");
  }
  if (attached.thread?.sessionId !== sessionA.sessionId) {
    throw new Error("thread snapshot is missing parent session id");
  }

  await assertHidden(
    `/langgraph/threads/${encodeURIComponent(threadA)}/state`,
    tenants.b,
    "tenant B thread read",
  );

  const runThreadA = await runStreamOnNewThread(tenants.a, "session boundary stream");
  const completed = await waitForCompletedRun(tenants.a, runThreadA, sessionA.sessionId!);
  const completedRunId = completed.latestRun?.id;
  if (!completedRunId) throw new Error("completed run is missing run id");

  console.log("Cloudflare session boundary smoke passed");
  console.log(
    JSON.stringify(
      {
        tenantASessionId: sessionA.sessionId,
        tenantBSessionId: sessionB.sessionId,
        tenantAThreadId: threadA,
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
