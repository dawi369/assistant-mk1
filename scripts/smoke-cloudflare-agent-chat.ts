import { type TenantIdentity, createSmokeContext, runSmoke } from "./smoke-utils";

type ChatSessionResponse = {
  ok?: boolean;
  activeThread?: { threadId?: string } | null;
  connection?: {
    agentName?: string;
    instanceName?: string;
    threadId?: string;
    sessionId?: string;
    workspaceId?: string;
    agentId?: string;
  } | null;
  error?: string;
};

type AdminSummaryResponse = {
  ok?: boolean;
  summary?: {
    chatRuntime?: {
      state?: string;
      latestSession?: { activeThreadId?: string } | null;
      latestThread?: { threadId?: string; upstream?: Record<string, unknown> } | null;
    };
    latestTrace?: {
      kind?: string;
      data?: Record<string, unknown>;
    } | null;
  };
};

const { baseUrl, suffix, readJson, assertStatus } = createSmokeContext();

const owner: TenantIdentity = {
  userId: `agent-chat-user-${suffix}`,
  accountId: `workos-org:agent-chat-org-${suffix}`,
  accountSource: "workos-organization",
  email: `agent-chat-${suffix}@example.com`,
  role: "owner",
  roles: ["owner"],
};

const otherTenant: TenantIdentity = {
  userId: `agent-chat-other-user-${suffix}`,
  accountId: `workos-org:agent-chat-other-org-${suffix}`,
  accountSource: "workos-organization",
  email: `agent-chat-other-${suffix}@example.com`,
  role: "owner",
  roles: ["owner"],
};

const getAgentContext = () => readJson<ChatSessionResponse>("/chat/session", owner);

const createAgentThread = () =>
  readJson<ChatSessionResponse>("/chat/session/threads", owner, {
    method: "POST",
    body: "{}",
  });

runSmoke("Cloudflare Agent chat context smoke", async () => {
  console.log(`Smoking Cloudflare Agent chat context at ${baseUrl}`);

  const first = await getAgentContext();
  if (
    !first.ok ||
    !first.connection?.threadId ||
    !first.connection.sessionId ||
    !first.connection.instanceName
  ) {
    throw new Error(first.error ?? "first Agent connection context was incomplete");
  }
  if (first.connection.agentName !== "workbench-thread-chat-agent") {
    throw new Error(`unexpected Agent name ${first.connection.agentName ?? "missing"}`);
  }

  const repeated = await getAgentContext();
  if (
    repeated.connection?.threadId !== first.connection.threadId ||
    repeated.connection?.instanceName !== first.connection.instanceName
  ) {
    throw new Error("repeated Agent context did not reuse the active thread");
  }

  const fresh = await createAgentThread();
  if (!fresh.connection?.threadId || fresh.connection.threadId === first.connection.threadId) {
    throw new Error("fresh Agent context did not create a new thread");
  }

  const summary = await readJson<AdminSummaryResponse>("/admin/workspace-summary", owner);
  if (summary.summary?.chatRuntime?.latestSession?.activeThreadId !== fresh.connection.threadId) {
    throw new Error("admin summary did not point at the fresh Agent thread");
  }
  if (summary.summary.chatRuntime.latestThread?.upstream?.runtime !== "cloudflare-agent-chat") {
    throw new Error("fresh thread was not marked as cloudflare-agent-chat");
  }

  await assertStatus(
    `/internal/chat-boundary/threads/${encodeURIComponent(fresh.connection.threadId)}/snapshot`,
    otherTenant,
    404,
  );

  console.log(
    JSON.stringify(
      {
        firstThreadId: first.connection.threadId,
        freshThreadId: fresh.connection.threadId,
        instanceName: fresh.connection.instanceName,
      },
      null,
      2,
    ),
  );
});

export {};
