type TenantIdentity = {
  userId: string;
  accountId: string;
  email: string;
  role?: string;
  roles?: string[];
};

type AgentSummary = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  profile: "default" | "analyst" | "operator";
  isDefault: boolean;
  isActive: boolean;
};

type AdminSummaryResponse = {
  ok?: boolean;
  summary?: {
    identity: {
      workspaceId?: string;
      agentId?: string;
    };
    activeAgent?: AgentSummary | null;
    agents?: AgentSummary[];
    chatRuntime?: {
      state?: string;
      latestSession?: {
        agentId?: string;
        metadata?: Record<string, unknown>;
      } | null;
      latestRun?: {
        id?: string;
        agentId?: string;
        status?: string;
        metadata?: Record<string, unknown>;
      } | null;
    };
  };
  error?: string;
};

type AgentsResponse = {
  ok?: boolean;
  activeAgentId?: string;
  agents?: AgentSummary[];
  error?: string;
};

type AgentMutationResponse = {
  ok?: boolean;
  activeAgentId?: string;
  agent?: AgentSummary | null;
  error?: string;
};

type WorkspaceMutationResponse = {
  ok?: boolean;
  activeWorkspaceId?: string;
  workspace?: {
    id?: string;
  } | null;
  error?: string;
};

type ThreadResponse = {
  thread_id?: string;
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
const accountId = `workos-org:agent-provisioning-org-${suffix}`;

const owner = {
  userId: `agent-provisioning-owner-${suffix}`,
  accountId,
  email: `agent-provisioning-owner-${suffix}@example.com`,
  role: "owner",
  roles: ["owner"],
} satisfies TenantIdentity;

const member = {
  userId: `agent-provisioning-member-${suffix}`,
  accountId,
  email: `agent-provisioning-member-${suffix}@example.com`,
  role: "member",
  roles: ["member"],
} satisfies TenantIdentity;

const otherAccount = {
  userId: `agent-provisioning-other-${suffix}`,
  accountId: `workos-org:agent-provisioning-other-org-${suffix}`,
  email: `agent-provisioning-other-${suffix}@example.com`,
  role: "owner",
  roles: ["owner"],
} satisfies TenantIdentity;

const headersFor = (identity: TenantIdentity) => {
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-assistant-mk1-user-id": identity.userId,
    "x-assistant-mk1-account-id": identity.accountId,
    "x-assistant-mk1-account-source": "workos-organization",
    "x-assistant-mk1-user-email": identity.email,
  };
  if (identity.role) headers["x-assistant-mk1-membership-role"] = identity.role;
  if (identity.roles) headers["x-assistant-mk1-membership-roles"] = JSON.stringify(identity.roles);
  return headers;
};

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

const assertStatus = async (
  path: string,
  identity: TenantIdentity,
  expectedStatus: number,
  init?: RequestInit,
) => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...headersFor(identity),
      ...init?.headers,
    },
  });
  if (response.status !== expectedStatus) {
    const body = await response.text();
    throw new Error(`${path} expected ${expectedStatus}, got ${response.status}: ${body}`);
  }
};

const adminSummary = async (identity: TenantIdentity, label: string) => {
  const body = await readJson<AdminSummaryResponse>("/admin/workspace-summary", identity);
  if (!body.ok || !body.summary?.identity.workspaceId || !body.summary.identity.agentId) {
    throw new Error(`${label} did not return a resolved admin summary`);
  }
  return body.summary;
};

const listAgents = async (identity: TenantIdentity) => {
  const body = await readJson<AgentsResponse>("/agents", identity);
  if (!body.ok || !body.agents) throw new Error(body.error ?? "agent list failed");
  return body;
};

const createAgent = (identity: TenantIdentity, input: Record<string, unknown>) =>
  readJson<AgentMutationResponse>("/agents", identity, {
    method: "POST",
    body: JSON.stringify(input),
  });

const createWorkspace = (identity: TenantIdentity, name: string) =>
  readJson<WorkspaceMutationResponse>("/workspaces", identity, {
    method: "POST",
    body: JSON.stringify({ name }),
  });

const activateWorkspace = (identity: TenantIdentity, workspaceId: string) =>
  readJson<WorkspaceMutationResponse>(
    `/workspaces/${encodeURIComponent(workspaceId)}/activate`,
    identity,
    { method: "POST" },
  );

const createThread = async (identity: TenantIdentity) => {
  const thread = await readJson<ThreadResponse>("/langgraph/threads", identity, {
    method: "POST",
    body: "{}",
  });
  if (!thread.thread_id) throw new Error(thread.error ?? "thread_id missing");
  return thread.thread_id;
};

const runStream = async (identity: TenantIdentity, threadId: string) => {
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
              content: "Say one short sentence confirming the active test agent is scoped.",
            },
          ],
        },
        stream_mode: ["messages"],
      }),
    },
  );
  const body = await response.text();
  if (!response.ok) throw new Error(`chat run failed with ${response.status}: ${body}`);
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForCompletedRun = async (identity: TenantIdentity, expectedAgentId: string) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < pollTimeoutMs) {
    const summary = await adminSummary(identity, "completed chat summary");
    const run = summary.chatRuntime?.latestRun;
    if (run?.status === "completed") {
      if (run.agentId !== expectedAgentId) {
        throw new Error(`chat run used ${run.agentId ?? "none"} instead of ${expectedAgentId}`);
      }
      const agentMetadata = run.metadata?.agent;
      if (
        !agentMetadata ||
        typeof agentMetadata !== "object" ||
        !("profile" in agentMetadata) ||
        agentMetadata.profile !== "analyst"
      ) {
        throw new Error("chat run metadata did not preserve analyst agent profile");
      }
      return summary;
    }
    if (run?.status === "failed") {
      throw new Error(`chat run failed: ${run.id ?? "unknown"}`);
    }
    await sleep(pollIntervalMs);
  }

  throw new Error(`chat run did not complete within ${pollTimeoutMs}ms`);
};

const main = async () => {
  console.log(`Smoking Cloudflare agent provisioning at ${baseUrl}`);

  const initialSummary = await adminSummary(owner, "initial owner");
  const initialWorkspaceId = initialSummary.identity.workspaceId;
  if (!initialWorkspaceId) {
    throw new Error("initial owner summary did not include a workspace id");
  }
  const initialDefaultAgentId = initialSummary.identity.agentId;
  if (initialSummary.agents?.length !== 1 || !initialSummary.activeAgent?.isDefault) {
    throw new Error("new workspace did not start with exactly one active default agent");
  }

  const created = await createAgent(owner, {
    name: "Analyst Test Agent",
    description: "Smoke-created workspace-scoped test agent.",
    profile: "analyst",
    activate: true,
  });
  if (!created.ok || !created.agent?.id || created.agent.profile !== "analyst") {
    throw new Error(created.error ?? "agent creation did not return an analyst agent");
  }
  if (created.activeAgentId !== created.agent.id || !created.agent.isActive) {
    throw new Error("created agent was not activated");
  }

  const afterCreate = await adminSummary(owner, "after agent create");
  if (
    afterCreate.identity.agentId !== created.agent.id ||
    afterCreate.activeAgent?.profile !== "analyst"
  ) {
    throw new Error("admin summary did not resolve created analyst agent as active");
  }

  const createdWorkspace = await createWorkspace(owner, "Agent Provisioning Workspace");
  const secondWorkspaceId = createdWorkspace.activeWorkspaceId ?? createdWorkspace.workspace?.id;
  if (!secondWorkspaceId || secondWorkspaceId === initialWorkspaceId) {
    throw new Error("workspace creation did not activate a second workspace");
  }
  const secondWorkspaceAgents = await listAgents(owner);
  if (secondWorkspaceAgents.agents?.some((agent) => agent.id === created.agent?.id)) {
    throw new Error("created agent leaked into another workspace");
  }
  if (secondWorkspaceAgents.agents?.length !== 1 || !secondWorkspaceAgents.agents[0]?.isDefault) {
    throw new Error("second workspace did not have its own default agent");
  }

  await activateWorkspace(owner, initialWorkspaceId);
  const afterWorkspaceSwitch = await adminSummary(owner, "after switching back");
  if (afterWorkspaceSwitch.identity.agentId !== created.agent.id) {
    throw new Error("original workspace did not retain active test agent preference");
  }

  const threadId = await createThread(owner);
  await runStream(owner, threadId);
  await waitForCompletedRun(owner, created.agent.id);

  await adminSummary(member, "member bootstrap");
  await assertStatus("/agents", member, 403, {
    method: "POST",
    body: JSON.stringify({
      name: "Member Test Agent",
      profile: "operator",
      activate: true,
    }),
  });
  await assertStatus(`/agents/${encodeURIComponent(created.agent.id)}/activate`, member, 403, {
    method: "POST",
  });

  await adminSummary(otherAccount, "other account bootstrap");
  await assertStatus(
    `/agents/${encodeURIComponent(created.agent.id)}/activate`,
    otherAccount,
    404,
    {
      method: "POST",
    },
  );

  console.log("Cloudflare agent provisioning smoke passed");
  console.log(
    JSON.stringify(
      {
        workspaceId: initialWorkspaceId,
        defaultAgentId: initialDefaultAgentId,
        createdAgentId: created.agent.id,
        secondWorkspaceId,
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
