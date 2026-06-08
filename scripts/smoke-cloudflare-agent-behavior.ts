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
  format?: string;
  templateId?: string;
  preview?: string;
};

type AgentSummary = {
  id?: string;
  name?: string;
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

type AgentBehaviorTemplatesResponse = {
  ok?: boolean;
  templates?: Array<{
    id?: string;
    name?: string;
    version?: string;
    format?: string;
    prompt?: string;
  }>;
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

const member = {
  userId: `agent-behavior-member-${suffix}`,
  accountId,
  email: `agent-behavior-member-${suffix}@example.com`,
  role: "member",
  roles: ["member"],
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

const fetchRaw = (path: string, identity: TenantIdentity, init?: RequestInit) =>
  fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...headersFor(identity),
      ...init?.headers,
    },
  });

const assertStatus = async (
  path: string,
  identity: TenantIdentity,
  expectedStatus: number,
  init?: RequestInit,
) => {
  const response = await fetchRaw(path, identity, init);
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
  if (!summary.activeAgent?.behavior?.profile || !summary.activeAgent.behavior.instructionId) {
    throw new Error(`${label} did not include active agent behavior config`);
  }
  return summary;
};

const getTemplates = () =>
  readJson<AgentBehaviorTemplatesResponse>("/agent-behavior-templates", owner);

const createAgent = (profile: Exclude<AgentProfile, "default">, behaviorTemplateId?: string) =>
  readJson<AgentMutationResponse>("/agents", owner, {
    method: "POST",
    body: JSON.stringify({
      name: `${behaviorTemplateId ?? profile} behavior smoke`,
      description: "Smoke-created behavior profile agent.",
      profile,
      behaviorTemplateId,
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

const waitForCompletedRun = async (expectedProfile: AgentProfile, expectedTemplateId: string) => {
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
        behaviorConfig.source !== "template-snapshot" ||
        !("templateId" in behaviorConfig) ||
        behaviorConfig.templateId !== expectedTemplateId ||
        "preview" in behaviorConfig
      ) {
        throw new Error(
          `completed run did not use ${expectedProfile}/${expectedTemplateId} behavior config`,
        );
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

const assertActiveTemplate = async (profile: AgentProfile, templateId: string) => {
  const summary = await adminSummary(`${profile} active summary`);
  if (
    summary.activeAgent?.profile !== profile ||
    summary.activeAgent.behavior?.profile !== profile ||
    summary.activeAgent.behavior.source !== "template-snapshot" ||
    summary.activeAgent.behavior.templateId !== templateId ||
    summary.activeAgent.behavior.format !== "xml" ||
    !summary.activeAgent.behavior.preview?.includes("<identity>")
  ) {
    throw new Error(`${profile}/${templateId} agent did not expose expected behavior config`);
  }
};

const main = async () => {
  console.log(`Smoking Cloudflare agent behavior at ${baseUrl}`);

  const templates = await getTemplates();
  const templateIds = new Set(templates.templates?.map((template) => template.id));
  for (const expectedTemplateId of [
    "assistant-general",
    "assistant-analyst",
    "assistant-operator",
    "assistant-integrator",
  ]) {
    if (!templateIds.has(expectedTemplateId)) {
      throw new Error(`template list did not include ${expectedTemplateId}`);
    }
  }

  const initial = await adminSummary("initial summary");
  const initialBehavior = initial.activeAgent?.behavior;
  if (initialBehavior?.profile !== "default") {
    throw new Error("default agent did not resolve default behavior config");
  }
  if (initialBehavior.source !== "server-preset") {
    throw new Error("existing bootstrap default agent should use server-preset fallback");
  }

  await assertStatus("/agents", owner, 400, {
    method: "POST",
    body: JSON.stringify({
      name: "Invalid Behavior Agent",
      profile: "analyst",
      behaviorTemplateId: "not-a-template",
    }),
  });

  await adminSummary("member bootstrap");
  await assertStatus("/agents", member, 403, {
    method: "POST",
    body: JSON.stringify({
      name: "Member Behavior Agent",
      profile: "analyst",
      behaviorTemplateId: "assistant-analyst",
    }),
  });

  const defaulted = await createAgent("analyst");
  if (
    !defaulted.ok ||
    defaulted.agent?.behavior?.source !== "template-snapshot" ||
    defaulted.agent.behavior.templateId !== "assistant-analyst"
  ) {
    throw new Error(defaulted.error ?? "omitted behavior template did not default by profile");
  }

  for (const [profile, templateId] of [
    ["analyst", "assistant-analyst"],
    ["operator", "assistant-operator"],
    ["operator", "assistant-integrator"],
  ] as const) {
    const created = await createAgent(profile, templateId);
    if (
      !created.ok ||
      !created.agent?.id ||
      created.activeAgentId !== created.agent.id ||
      created.agent.behavior?.profile !== profile ||
      created.agent.behavior.source !== "template-snapshot" ||
      created.agent.behavior.templateId !== templateId ||
      !created.agent.behavior.preview?.includes("<identity>")
    ) {
      throw new Error(created.error ?? `${profile}/${templateId} behavior agent was not created`);
    }

    await assertActiveTemplate(profile, templateId);
    const threadId = await createThread();
    await runStream(threadId, `Reply with one short ${templateId} mode sentence.`);
    const runId = await waitForCompletedRun(profile, templateId);
    await assertNoStoredSystemMessages(threadId);

    console.log(`${profile}/${templateId} behavior run completed: ${runId}`);
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
