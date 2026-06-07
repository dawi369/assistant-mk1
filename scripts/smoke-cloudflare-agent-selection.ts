import {
  type TenantIdentity,
  createSmokeContext,
  defaultWorkspaceId,
  runSmoke,
} from "./smoke-utils";

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

const { baseUrl, suffix, readJson, assertStatus } = createSmokeContext();

const accountId = `workos-org:agent-selection-org-${suffix}`;
const defaultWsId = defaultWorkspaceId(accountId);

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

runSmoke("Cloudflare agent selection smoke", async () => {
  console.log(`Smoking Cloudflare agent selection at ${baseUrl}`);

  const initial = requireSummary(
    await readJson<AdminSummaryResponse>("/admin/workspace-summary", ownerTenant),
    "initial admin summary",
  );
  if (initial.identity?.workspaceId !== defaultWsId) {
    throw new Error("initial request did not resolve the account default workspace");
  }
  if (initial.activeAgent?.id !== initial.defaultAgent?.id) {
    throw new Error("initial active agent did not fall back to the workspace default agent");
  }
  const activeAgentId = initial.identity.agentId;
  if (!activeAgentId) {
    throw new Error("initial summary did not include an active agent id");
  }

  const list = await readJson<AgentsResponse>("/agents", ownerTenant);
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
});

export {};
