type TenantIdentity = {
  userId: string;
  accountId: string;
  accountSource: string;
  email?: string;
  name?: string;
  role?: string;
  roles?: string[];
  permissions?: string[];
  membershipStatus?: string;
};

type AgentSummary = {
  id?: string;
  name?: string;
  status?: string;
  isDefault?: boolean;
  isActive?: boolean;
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

type AdminSummaryResponse = {
  ok?: boolean;
  summary?: {
    identity?: {
      userId?: string;
      workspaceId?: string;
      agentId?: string;
    };
    membership?: {
      role?: string;
      status?: string;
    } | null;
    defaultAgent?: AgentSummary | null;
    activeAgent?: AgentSummary | null;
    agents?: AgentSummary[];
  };
  error?: string;
};

type SessionResponse = {
  ok?: boolean;
  session?: {
    sessionId?: string;
    agentId?: string;
    scope?: {
      userId?: string;
      workspaceId?: string;
    };
  } | null;
  error?: string;
};

const baseUrl = (process.env.CLOUDFLARE_CONTROL_PLANE_URL ?? "http://localhost:8787").replace(
  /\/$/,
  "",
);
const token = process.env.CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN ?? "local-dev-token";
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const accountId = `workos-org:agent-selection-org-${suffix}`;
const defaultWorkspaceId = `workspace:${accountId}:default`;

const ownerTenant: TenantIdentity = {
  userId: `agent-selection-owner-${suffix}`,
  accountId,
  accountSource: "workos-organization",
  email: `agent-selection-owner-${suffix}@example.com`,
  name: "Agent Selection Owner",
  role: "owner",
  roles: ["owner"],
  permissions: ["workbench:read", "workbench:agent"],
};

const memberTenant: TenantIdentity = {
  ...ownerTenant,
  userId: `agent-selection-member-${suffix}`,
  email: `agent-selection-member-${suffix}@example.com`,
  name: "Agent Selection Member",
  role: "member",
  roles: ["member"],
};

const otherAccountTenant: TenantIdentity = {
  ...ownerTenant,
  userId: `agent-selection-other-${suffix}`,
  accountId: `workos-org:agent-selection-other-org-${suffix}`,
  email: `agent-selection-other-${suffix}@example.com`,
  name: "Agent Selection Other Owner",
};

const disabledTenant: TenantIdentity = {
  ...ownerTenant,
  userId: `agent-selection-disabled-${suffix}`,
  accountId: `workos-org:agent-selection-disabled-org-${suffix}`,
  email: `agent-selection-disabled-${suffix}@example.com`,
  name: "Agent Selection Disabled Member",
  role: "member",
  roles: ["member"],
  membershipStatus: "disabled",
};

const headersFor = (identity: TenantIdentity) => {
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-assistant-mk1-user-id": identity.userId,
    "x-assistant-mk1-account-id": identity.accountId,
    "x-assistant-mk1-account-source": identity.accountSource,
  };

  if (identity.email) headers["x-assistant-mk1-user-email"] = identity.email;
  if (identity.name) headers["x-assistant-mk1-user-name"] = identity.name;
  if (identity.role) headers["x-assistant-mk1-membership-role"] = identity.role;
  if (identity.roles) headers["x-assistant-mk1-membership-roles"] = JSON.stringify(identity.roles);
  if (identity.permissions) {
    headers["x-assistant-mk1-membership-permissions"] = JSON.stringify(identity.permissions);
  }
  if (identity.membershipStatus) {
    headers["x-assistant-mk1-membership-status"] = identity.membershipStatus;
  }

  return headers;
};

const readJson = async <T>(
  path: string,
  identity: TenantIdentity = ownerTenant,
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

const requireSummary = (body: AdminSummaryResponse, label: string) => {
  const summary = body.summary;
  if (!body.ok || !summary?.identity?.workspaceId || !summary.identity.agentId) {
    throw new Error(`${label} did not return a resolved admin summary`);
  }
  if (!summary.defaultAgent?.id || !summary.defaultAgent.isDefault) {
    throw new Error(`${label} did not return a workspace default agent`);
  }
  if (!summary.activeAgent?.id || !summary.activeAgent.isActive) {
    throw new Error(`${label} did not return an active agent`);
  }
  if (summary.identity.agentId !== summary.activeAgent.id) {
    throw new Error(`${label} identity agent did not match active agent`);
  }
  return summary;
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
    throw new Error(
      `${init?.method ?? "GET"} ${path} expected ${expectedStatus}, got ${response.status}: ${body}`,
    );
  }
};

const main = async () => {
  console.log(`Smoking Cloudflare agent selection at ${baseUrl}`);

  const initial = requireSummary(
    await readJson<AdminSummaryResponse>("/admin/workspace-summary"),
    "initial admin summary",
  );
  if (initial.identity?.workspaceId !== defaultWorkspaceId) {
    throw new Error("initial request did not resolve the account default workspace");
  }
  if (initial.activeAgent?.id !== initial.defaultAgent?.id) {
    throw new Error("initial active agent did not fall back to the workspace default agent");
  }
  const activeAgentId = initial.identity.agentId;
  if (!activeAgentId) {
    throw new Error("initial summary did not include an active agent id");
  }

  const list = await readJson<AgentsResponse>("/agents");
  if (!list.ok || list.activeAgentId !== activeAgentId) {
    throw new Error("agent list did not expose the resolved active agent");
  }
  if (!list.agents?.some((agent) => agent.id === activeAgentId && agent.isActive)) {
    throw new Error("agent list did not mark the active agent");
  }

  const activated = await readJson<AgentMutationResponse>(
    `/agents/${encodeURIComponent(activeAgentId)}/activate`,
    ownerTenant,
    { method: "POST" },
  );
  if (!activated.ok || activated.activeAgentId !== activeAgentId) {
    throw new Error(activated.error ?? "owner activation of provisioned agent failed");
  }

  const session = await readJson<SessionResponse>("/sessions", ownerTenant, {
    method: "POST",
    body: JSON.stringify({ metadata: { source: "agent-selection-smoke" } }),
  });
  if (!session.ok || session.session?.agentId !== activeAgentId) {
    throw new Error("session did not use the active agent preference");
  }

  const memberSummary = requireSummary(
    await readJson<AdminSummaryResponse>("/admin/workspace-summary", memberTenant),
    "member admin summary",
  );
  if (memberSummary.membership?.role !== "member") {
    throw new Error("second org user did not bootstrap as member");
  }
  await assertStatus(`/agents/${encodeURIComponent(activeAgentId)}/activate`, memberTenant, 403, {
    method: "POST",
  });

  await readJson<AdminSummaryResponse>("/admin/workspace-summary", otherAccountTenant);
  await assertStatus(
    `/agents/${encodeURIComponent(activeAgentId)}/activate`,
    otherAccountTenant,
    404,
    { method: "POST" },
  );

  await assertStatus("/agents", disabledTenant, 403);

  console.log("Cloudflare agent selection smoke passed");
  console.log(
    JSON.stringify(
      {
        accountId,
        workspaceId: initial.identity.workspaceId,
        activeAgentId,
        ownerSessionId: session.session?.sessionId,
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
