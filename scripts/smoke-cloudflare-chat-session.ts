import { type TenantIdentity, createSmokeContext, runSmoke } from "./smoke-utils";

type AgentSummary = {
  id: string;
  name: string;
  profile: "default" | "analyst" | "operator";
  isActive: boolean;
};

type ChatSessionResponse = {
  ok?: boolean;
  revision?: number;
  partial?: boolean;
  threadsRefreshRecommended?: boolean;
  transition?: {
    type?: "initial" | "create" | "activate" | "token_refresh";
    startedAt?: string;
  };
  activeAgent?: AgentSummary | null;
  activeThread?: {
    threadId?: string;
    agentId?: string;
  } | null;
  threads?: Array<{
    threadId?: string;
    agentId?: string;
    agent?: AgentSummary | null;
    isActive?: boolean;
  }>;
  connection?: {
    agentHost?: string;
    agentName?: string;
    instanceName?: string;
    token?: string;
    threadId?: string;
    sessionId?: string;
    workspaceId?: string;
    agentId?: string;
    expiresAt?: string;
  };
  expiresAt?: string;
  error?: string;
};

type AgentMutationResponse = {
  ok?: boolean;
  activeAgentId?: string;
  agent?: AgentSummary | null;
  error?: string;
};

const { baseUrl, suffix, readJson, assertStatus } = createSmokeContext();

const owner: TenantIdentity = {
  userId: `chat-session-owner-${suffix}`,
  accountId: `workos-org:chat-session-org-${suffix}`,
  accountSource: "workos-organization",
  email: `chat-session-owner-${suffix}@example.com`,
  role: "owner",
  roles: ["owner"],
};

const otherTenant: TenantIdentity = {
  userId: `chat-session-other-${suffix}`,
  accountId: `workos-org:chat-session-other-org-${suffix}`,
  accountSource: "workos-organization",
  email: `chat-session-other-${suffix}@example.com`,
  role: "owner",
  roles: ["owner"],
};

const getSession = (identity: TenantIdentity) =>
  readJson<ChatSessionResponse>("/chat/session", identity);

const refreshThreads = (identity: TenantIdentity) =>
  readJson<ChatSessionResponse>("/chat/session?refresh=threads", identity);

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

const createAgent = (identity: TenantIdentity, input: Record<string, unknown>) =>
  readJson<AgentMutationResponse>("/agents", identity, {
    method: "POST",
    body: JSON.stringify(input),
  });

const assertSessionConnection = (session: ChatSessionResponse, label: string) => {
  if (
    !session.ok ||
    !session.connection?.agentHost ||
    !session.connection.agentName ||
    !session.connection.instanceName ||
    !session.connection.token ||
    !session.connection.threadId ||
    !session.connection.sessionId ||
    !session.connection.expiresAt ||
    typeof session.revision !== "number"
  ) {
    throw new Error(`${label} did not include a complete Agent connection`);
  }
};

runSmoke("Cloudflare chat session smoke", async () => {
  console.log(`Smoking Cloudflare chat session at ${baseUrl}`);

  const initial = await getSession(owner);
  assertSessionConnection(initial, "initial session");
  const defaultAgentId = initial.activeAgent?.id;
  const threadA = initial.activeThread?.threadId;
  if (!defaultAgentId || !threadA || initial.connection?.agentId !== defaultAgentId) {
    throw new Error("initial session did not resolve a default active agent/thread");
  }

  const threadBSession = await createThread(owner);
  assertSessionConnection(threadBSession, "new thread session");
  const threadB = threadBSession.activeThread?.threadId;
  if (!threadB || threadB === threadA) throw new Error("new thread did not become active");
  if (
    threadBSession.partial !== true ||
    threadBSession.threadsRefreshRecommended !== true ||
    threadBSession.transition?.type !== "create"
  ) {
    throw new Error("new thread response was not marked as a partial create transition");
  }

  const analyst = await createAgent(owner, {
    name: "Session Analyst Agent",
    profile: "analyst",
    activate: true,
  });
  if (!analyst.ok || !analyst.agent?.id || analyst.activeAgentId !== analyst.agent.id) {
    throw new Error(analyst.error ?? "analyst agent was not created and activated");
  }

  const analystThreadSession = await createThread(owner);
  assertSessionConnection(analystThreadSession, "analyst thread session");
  const analystThread = analystThreadSession.activeThread?.threadId;
  if (
    !analystThread ||
    analystThreadSession.activeAgent?.id !== analyst.agent.id ||
    analystThreadSession.activeThread?.agentId !== analyst.agent.id
  ) {
    throw new Error("analyst thread did not use the active analyst agent");
  }
  if (
    analystThreadSession.partial !== true ||
    analystThreadSession.threadsRefreshRecommended !== true
  ) {
    throw new Error("agent-backed thread creation did not return a partial transition response");
  }

  const fullHistory = await refreshThreads(owner);
  assertSessionConnection(fullHistory, "full history session");

  const historyThreadIds = new Set(
    (fullHistory.threads ?? []).map((thread) => thread.threadId).filter(Boolean),
  );
  for (const expected of [threadA, threadB, analystThread]) {
    if (!historyThreadIds.has(expected)) {
      throw new Error(`workspace history did not include ${expected}`);
    }
  }

  const restored = await activateThread(owner, threadA);
  assertSessionConnection(restored, "restored session");
  if (restored.activeThread?.threadId !== threadA || restored.activeAgent?.id !== defaultAgentId) {
    throw new Error("activating the old default-agent thread did not restore its owning agent");
  }
  if (
    restored.partial !== true ||
    restored.threadsRefreshRecommended !== true ||
    restored.transition?.type !== "activate"
  ) {
    throw new Error("thread activation response was not marked as a partial activate transition");
  }

  const refreshed = await getSession(owner);
  assertSessionConnection(refreshed, "refreshed session");
  if (
    refreshed.activeThread?.threadId !== threadA ||
    refreshed.connection?.threadId !== threadA ||
    refreshed.connection.token === restored.connection?.token ||
    refreshed.threadsRefreshRecommended === true
  ) {
    throw new Error("token refresh did not preserve the active thread and issue a fresh token");
  }

  await assertStatus(
    `/chat/session/threads/${encodeURIComponent(analystThread)}/activate`,
    otherTenant,
    404,
    { method: "POST", body: "{}" },
  );

  console.log(
    JSON.stringify(
      {
        threadA,
        threadB,
        analystThread,
        restoredAgentId: restored.activeAgent?.id,
        refreshedRevision: refreshed.revision,
        listedThreads: refreshed.threads?.length ?? 0,
      },
      null,
      2,
    ),
  );
});

export {};
