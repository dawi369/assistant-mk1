type TenantIdentity = {
  userId: string;
  accountId: string;
  email: string;
  role: string;
  roles: string[];
};

type AgentProfile = "default" | "analyst" | "operator";

type AgentBehaviorConfig = {
  profile?: AgentProfile;
  source?: string;
  version?: string;
  instructionId?: string;
};

type AgentSummary = {
  id?: string;
  profile?: AgentProfile;
  behavior?: AgentBehaviorConfig;
  isActive?: boolean;
};

type AdminSummaryResponse = {
  ok?: boolean;
  summary?: {
    identity?: {
      agentId?: string;
      workspaceId?: string;
    };
    activeAgent?: AgentSummary | null;
    chatRuntime?: {
      latestRun?: {
        id?: string;
        status?: string;
        metadata?: Record<string, unknown>;
      } | null;
    };
  };
  error?: string;
};

type AgentMutationResponse = {
  ok?: boolean;
  activeAgentId?: string;
  agent?: AgentSummary | null;
  error?: string;
};

type ThreadResponse = {
  thread_id?: string;
  error?: string;
};

type ThreadStateResponse = {
  values?: {
    messages?: Array<{
      type?: string;
      role?: string;
      content?: string;
    }>;
  };
};

const baseUrl = (process.env.CLOUDFLARE_CONTROL_PLANE_URL ?? "http://localhost:8787").replace(
  /\/$/,
  "",
);
const token = process.env.CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN ?? "local-dev-token";
const pollTimeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? 30_000);
const pollIntervalMs = Number(process.env.SMOKE_POLL_INTERVAL_MS ?? 400);
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const accountId = `workos-org:agent-behavior-org-${suffix}`;

const owner = {
  userId: `agent-behavior-owner-${suffix}`,
  accountId,
  email: `agent-behavior-owner-${suffix}@example.com`,
  role: "owner",
  roles: ["owner"],
} satisfies TenantIdentity;

const headersFor = (identity: TenantIdentity) => ({
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
  "x-assistant-mk1-user-id": identity.userId,
  "x-assistant-mk1-account-id": identity.accountId,
  "x-assistant-mk1-account-source": "workos-organization",
  "x-assistant-mk1-user-email": identity.email,
  "x-assistant-mk1-membership-role": identity.role,
  "x-assistant-mk1-membership-roles": JSON.stringify(identity.roles),
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

const adminSummary = async (label: string) => {
  const body = await readJson<AdminSummaryResponse>("/admin/workspace-summary", owner);
  const summary = body.summary;
  if (!body.ok || !summary?.identity?.workspaceId || !summary.identity.agentId) {
    throw new Error(`${label} did not resolve workspace and agent identity`);
  }
  if (!summary.activeAgent?.behavior?.profile || !summary.activeAgent.behavior.instructionId) {
    throw new Error(`${label} did not include active agent behavior config`);
  }
  return summary;
};

const createAgent = (profile: Exclude<AgentProfile, "default">) =>
  readJson<AgentMutationResponse>("/agents", owner, {
    method: "POST",
    body: JSON.stringify({
      name: `${profile} behavior smoke`,
      description: "Smoke-created behavior profile agent.",
      profile,
      activate: true,
    }),
  });

const createThread = async () => {
  const thread = await readJson<ThreadResponse>("/langgraph/threads", owner, {
    method: "POST",
    body: "{}",
  });
  if (!thread.thread_id) throw new Error(thread.error ?? "thread_id missing");
  return thread.thread_id;
};

const runStream = async (threadId: string, prompt: string) => {
  const response = await fetch(
    `${baseUrl}/langgraph/threads/${encodeURIComponent(threadId)}/runs/stream`,
    {
      method: "POST",
      headers: headersFor(owner),
      body: JSON.stringify({
        assistant_id: "agent",
        input: {
          messages: [
            {
              role: "system",
              content: "Browser supplied system text that must not become durable behavior.",
            },
            {
              role: "user",
              content: prompt,
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

const waitForCompletedRun = async (expectedProfile: AgentProfile) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < pollTimeoutMs) {
    const summary = await adminSummary(`${expectedProfile} chat summary`);
    const run = summary.chatRuntime?.latestRun;
    if (run?.status === "completed") {
      const behaviorConfig = run.metadata?.behaviorConfig;
      if (
        !behaviorConfig ||
        typeof behaviorConfig !== "object" ||
        !("profile" in behaviorConfig) ||
        behaviorConfig.profile !== expectedProfile ||
        !("source" in behaviorConfig) ||
        behaviorConfig.source !== "server-preset"
      ) {
        throw new Error(`completed run did not use ${expectedProfile} behavior config`);
      }
      return run.id;
    }
    if (run?.status === "failed") {
      throw new Error(`chat run failed: ${run.id ?? "unknown"}`);
    }
    await sleep(pollIntervalMs);
  }

  throw new Error(`chat run did not complete within ${pollTimeoutMs}ms`);
};

const assertNoStoredSystemMessages = async (threadId: string) => {
  const state = await readJson<ThreadStateResponse>(
    `/langgraph/threads/${encodeURIComponent(threadId)}/state`,
    owner,
  );
  const systemMessage = state.values?.messages?.find(
    (message) => message.type === "system" || message.role === "system",
  );
  if (systemMessage) {
    throw new Error("browser/system behavior message leaked into stored thread state");
  }
};

const assertActiveProfile = async (profile: AgentProfile) => {
  const summary = await adminSummary(`${profile} active summary`);
  if (
    summary.activeAgent?.profile !== profile ||
    summary.activeAgent.behavior?.profile !== profile ||
    summary.activeAgent.behavior.source !== "server-preset"
  ) {
    throw new Error(`${profile} agent did not expose expected behavior config`);
  }
};

const main = async () => {
  console.log(`Smoking Cloudflare agent behavior at ${baseUrl}`);

  const initial = await adminSummary("initial summary");
  if (initial.activeAgent?.behavior?.profile !== "default") {
    throw new Error("default agent did not resolve default behavior config");
  }

  for (const profile of ["analyst", "operator"] as const) {
    const created = await createAgent(profile);
    if (
      !created.ok ||
      !created.agent?.id ||
      created.activeAgentId !== created.agent.id ||
      created.agent.behavior?.profile !== profile
    ) {
      throw new Error(created.error ?? `${profile} behavior agent was not created`);
    }

    await assertActiveProfile(profile);
    const threadId = await createThread();
    await runStream(threadId, `Reply with one short ${profile} mode sentence.`);
    const runId = await waitForCompletedRun(profile);
    await assertNoStoredSystemMessages(threadId);

    console.log(`${profile} behavior run completed: ${runId}`);
  }

  console.log("Cloudflare agent behavior smoke passed");
  console.log(
    JSON.stringify(
      {
        accountId,
        profiles: ["default", "analyst", "operator"],
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
