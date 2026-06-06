type TenantIdentity = {
  userId: string;
  accountId: string;
  email: string;
  role: string;
  roles: string[];
};

type AgentRuntimeConfig = {
  provider?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  source?: string;
};

type AgentSummary = {
  id?: string;
  profile?: "default" | "analyst" | "operator";
  runtime?: AgentRuntimeConfig;
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

const baseUrl = (process.env.CLOUDFLARE_CONTROL_PLANE_URL ?? "http://localhost:8787").replace(
  /\/$/,
  "",
);
const token = process.env.CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN ?? "local-dev-token";
const pollTimeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? 30_000);
const pollIntervalMs = Number(process.env.SMOKE_POLL_INTERVAL_MS ?? 400);
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const accountId = `workos-org:agent-runtime-config-org-${suffix}`;
const modelOptions = ["deepseek/deepseek-v4-flash", "openai/gpt-4.1-mini"] as const;

const owner = {
  userId: `agent-runtime-config-owner-${suffix}`,
  accountId,
  email: `agent-runtime-config-owner-${suffix}@example.com`,
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

const adminSummary = async (label: string) => {
  const body = await readJson<AdminSummaryResponse>("/admin/workspace-summary", owner);
  const summary = body.summary;
  if (!body.ok || !summary?.identity?.workspaceId || !summary.identity.agentId) {
    throw new Error(`${label} did not resolve workspace and agent identity`);
  }
  if (!summary.activeAgent?.runtime?.model || !summary.activeAgent.runtime.source) {
    throw new Error(`${label} did not include active agent runtime config`);
  }
  return summary;
};

const createAgent = (input: Record<string, unknown>) =>
  readJson<AgentMutationResponse>("/agents", owner, {
    method: "POST",
    body: JSON.stringify(input),
  });

const createThread = async () => {
  const thread = await readJson<ThreadResponse>("/langgraph/threads", owner, {
    method: "POST",
    body: "{}",
  });
  if (!thread.thread_id) throw new Error(thread.error ?? "thread_id missing");
  return thread.thread_id;
};

const runStream = async (threadId: string) => {
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
              role: "user",
              content: "Reply with one short sentence for the runtime config smoke.",
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

const waitForCompletedRun = async (expectedModel: string) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < pollTimeoutMs) {
    const summary = await adminSummary("runtime chat summary");
    const run = summary.chatRuntime?.latestRun;
    if (run?.status === "completed") {
      const runtimeConfig = run.metadata?.runtimeConfig;
      const model = run.metadata?.model;
      if (
        !runtimeConfig ||
        typeof runtimeConfig !== "object" ||
        !("model" in runtimeConfig) ||
        runtimeConfig.model !== expectedModel ||
        model !== expectedModel
      ) {
        throw new Error("completed run did not use selected agent runtime model");
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

const main = async () => {
  console.log(`Smoking Cloudflare agent runtime config at ${baseUrl}`);

  const initial = await adminSummary("initial summary");
  if (initial.activeAgent?.runtime?.source !== "system-default") {
    throw new Error("default agent did not fall back to system runtime config");
  }
  const fallbackModel = initial.activeAgent.runtime.model;
  const selectedModel = fallbackModel === modelOptions[0] ? modelOptions[1] : modelOptions[0];

  await assertStatus("/agents", owner, 400, {
    method: "POST",
    body: JSON.stringify({
      name: "Invalid Runtime Agent",
      profile: "analyst",
      model: "not-a-real/model",
      activate: true,
    }),
  });

  const created = await createAgent({
    name: "Runtime Config Analyst",
    description: "Smoke-created agent with explicit runtime config.",
    profile: "analyst",
    model: selectedModel,
    activate: true,
  });
  if (
    !created.ok ||
    !created.agent?.id ||
    created.activeAgentId !== created.agent.id ||
    created.agent.runtime?.source !== "agent" ||
    created.agent.runtime.model !== selectedModel
  ) {
    throw new Error(created.error ?? "agent runtime config was not stored or activated");
  }

  const afterCreate = await adminSummary("after runtime agent create");
  const activeAgentId = afterCreate.identity?.agentId;
  if (
    activeAgentId !== created.agent.id ||
    afterCreate.activeAgent?.runtime?.model !== selectedModel
  ) {
    throw new Error("admin summary did not resolve selected runtime-configured agent");
  }

  const threadId = await createThread();
  await runStream(threadId);
  const runId = await waitForCompletedRun(selectedModel);

  console.log("Cloudflare agent runtime config smoke passed");
  console.log(
    JSON.stringify(
      {
        fallbackModel,
        selectedModel,
        agentId: created.agent.id,
        runId,
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
