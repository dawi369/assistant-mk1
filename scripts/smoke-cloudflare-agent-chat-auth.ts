import { type TenantIdentity, createSmokeContext, runSmoke } from "./smoke-utils";

type ChatSessionResponse = {
  ok?: boolean;
  connection?: {
    agentName?: string;
    instanceName?: string;
    threadId?: string;
    sessionId?: string;
    workspaceId?: string;
    agentId?: string;
    token?: string;
  } | null;
  error?: string;
};

const { baseUrl, suffix, readJson } = createSmokeContext();

const owner: TenantIdentity = {
  userId: `agent-chat-auth-user-${suffix}`,
  accountId: `workos-org:agent-chat-auth-org-${suffix}`,
  accountSource: "workos-organization",
  email: `agent-chat-auth-${suffix}@example.com`,
  role: "owner",
  roles: ["owner"],
};

const expectStatus = async (label: string, path: string, expectedStatus: number) => {
  const response = await fetch(`${baseUrl}${path}`);
  if (response.status !== expectedStatus) {
    const body = await response.text();
    throw new Error(`${label} expected ${expectedStatus}, got ${response.status}: ${body}`);
  }
};

const expectStatusIn = async (label: string, path: string, expectedStatuses: number[]) => {
  const response = await fetch(`${baseUrl}${path}`);
  if (!expectedStatuses.includes(response.status)) {
    const body = await response.text();
    throw new Error(
      `${label} expected one of ${expectedStatuses.join(", ")}, got ${response.status}: ${body}`,
    );
  }
};

runSmoke("Cloudflare Agent chat auth smoke", async () => {
  console.log(`Smoking Cloudflare Agent chat auth at ${baseUrl}`);

  const context = await readJson<ChatSessionResponse>("/chat/session/threads", owner, {
    method: "POST",
    body: "{}",
  });
  if (
    !context.ok ||
    !context.connection?.agentName ||
    !context.connection.instanceName ||
    !context.connection.threadId ||
    !context.connection.sessionId ||
    !context.connection.workspaceId ||
    !context.connection.agentId ||
    !context.connection.token
  ) {
    throw new Error(context.error ?? "Agent connection context was incomplete");
  }

  const route = `/agents/${context.connection.agentName}/${context.connection.instanceName}`;
  await expectStatus("missing token", route, 401);

  const tamperedToken = `${context.connection.token.slice(0, -1)}x`;
  await expectStatus("tampered token", `${route}?token=${encodeURIComponent(tamperedToken)}`, 401);

  await expectStatusIn(
    "instance-mismatched token",
    `/agents/${context.connection.agentName}/${context.connection.instanceName}-other?token=${encodeURIComponent(context.connection.token)}`,
    [403],
  );
});

export {};
