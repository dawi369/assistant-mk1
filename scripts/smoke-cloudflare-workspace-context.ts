import {
  type TenantIdentity,
  createSmokeContext,
  defaultWorkspaceId,
  runSmoke,
} from "./smoke-utils";

type SessionResponse = {
  ok?: boolean;
  session?: {
    sessionId?: string;
    agentId?: string;
  } | null;
  error?: string;
};

type WorkspaceContextResponse = {
  ok?: boolean;
  context?: {
    identity: {
      userId?: string;
      workspaceId?: string;
      agentId?: string;
      authMode?: string;
      workspaceSource?: string;
    };
    account?: {
      id?: string;
      source?: string;
    } | null;
    user?: {
      email?: string;
    } | null;
    workspace?: {
      id?: string;
      status?: string;
      isDefault?: boolean;
    } | null;
    membership?: {
      role?: string;
      status?: string;
    } | null;
    agent?: {
      id?: string;
      status?: string;
      isDefault?: boolean;
    } | null;
  };
  error?: string;
};

const { baseUrl, suffix, signedHeadersFor, readJson } = createSmokeContext();

const tenantA: TenantIdentity = {
  userId: `context-user-a-${suffix}`,
  accountId: `workos-org:context-org-a-${suffix}`,
  accountSource: "workos-organization",
  workspaceId: defaultWorkspaceId(`workos-org:context-org-a-${suffix}`),
  email: `context-a-${suffix}@example.com`,
  name: "Workspace Context Smoke User A",
  role: "owner",
  roles: ["owner"],
  permissions: ["workbench:read"],
  authMode: "workos",
  workspaceSource: "workos-organization",
};

const tenantB: TenantIdentity = {
  userId: `context-user-b-${suffix}`,
  accountId: `workos-org:context-org-b-${suffix}`,
  accountSource: "workos-organization",
  workspaceId: defaultWorkspaceId(`workos-org:context-org-b-${suffix}`),
  email: `context-b-${suffix}@example.com`,
  name: "Workspace Context Smoke User B",
  role: "owner",
  roles: ["owner"],
  permissions: ["workbench:read"],
  authMode: "workos",
  workspaceSource: "workos-organization",
};

const disabledTenant: TenantIdentity = {
  userId: `context-disabled-user-${suffix}`,
  accountId: `workos-org:context-disabled-org-${suffix}`,
  accountSource: "workos-organization",
  workspaceId: defaultWorkspaceId(`workos-org:context-disabled-org-${suffix}`),
  email: `context-disabled-${suffix}@example.com`,
  name: "Workspace Context Smoke Disabled User",
  role: "member",
  membershipStatus: "disabled",
  authMode: "workos",
  workspaceSource: "workos-organization",
};

const requireContext = (
  body: WorkspaceContextResponse,
  identity: TenantIdentity,
  label: string,
) => {
  const context = body.context;
  if (!body.ok || !context?.identity?.workspaceId || !context.identity.agentId) {
    throw new Error(`${label} did not return a resolved workspace context`);
  }
  if (context.identity.userId !== identity.userId) {
    throw new Error(`${label} returned the wrong user identity`);
  }
  if (context.identity.authMode !== identity.authMode) {
    throw new Error(`${label} returned authMode ${context.identity.authMode}`);
  }
  if (context.identity.workspaceSource !== identity.workspaceSource) {
    throw new Error(`${label} returned workspaceSource ${context.identity.workspaceSource}`);
  }
  if (
    context.account?.id !== identity.accountId ||
    context.account?.source !== identity.accountSource
  ) {
    throw new Error(`${label} returned the wrong account identity`);
  }
  if (context.user?.email !== identity.email) {
    throw new Error(`${label} did not materialize the expected user metadata`);
  }
  if (context.workspace?.status !== "active" || !context.workspace.isDefault) {
    throw new Error(`${label} did not return an active default workspace`);
  }
  if (context.membership?.status !== "active" || context.membership.role !== identity.role) {
    throw new Error(`${label} did not return the expected active membership`);
  }
  if (context.agent?.id !== context.identity.agentId || !context.agent?.isDefault) {
    throw new Error(`${label} did not return the resolved default agent`);
  }
  if (context.agent.status !== "active") {
    throw new Error(`${label} did not return an active agent`);
  }
  return context;
};

const assertDisabledMembership = async () => {
  const response = await fetch(`${baseUrl}/workspace-context`, {
    headers: await signedHeadersFor(disabledTenant, "/workspace-context"),
  });
  if (response.status !== 403) {
    throw new Error(`disabled membership context expected 403, got ${response.status}`);
  }
};

const assertSessionHidden = async (identity: TenantIdentity, sessionId: string, label: string) => {
  const path = `/sessions/${encodeURIComponent(sessionId)}`;
  const response = await fetch(`${baseUrl}${path}`, {
    headers: await signedHeadersFor(identity, path),
  });
  if (response.status !== 404) {
    throw new Error(
      `${label} expected cross-workspace session read to return 404, got ${response.status}`,
    );
  }
};

runSmoke("Cloudflare workspace context smoke", async () => {
  console.log(`Smoking Cloudflare workspace context at ${baseUrl}`);

  const first = requireContext(
    await readJson<WorkspaceContextResponse>("/workspace-context", tenantA),
    tenantA,
    "first context request",
  );
  const second = requireContext(
    await readJson<WorkspaceContextResponse>("/workspace-context", tenantA),
    tenantA,
    "second context request",
  );

  if (first.identity.agentId !== second.identity.agentId) {
    throw new Error("default agent resolution changed between workspace-context requests");
  }
  if (first.identity.workspaceId === tenantA.accountId) {
    throw new Error("workspace context returned the raw WorkOS account id as workspace id");
  }

  const sessionA = await readJson<SessionResponse>("/sessions", tenantA, {
    method: "POST",
    body: JSON.stringify({ metadata: { source: "workspace-context-smoke" } }),
  });
  const sessionId = sessionA.session?.sessionId;
  if (!sessionA.ok || !sessionId) {
    throw new Error("tenant A session was not created for cross-workspace assertion");
  }

  requireContext(
    await readJson<WorkspaceContextResponse>("/workspace-context", tenantB),
    tenantB,
    "tenant B context request",
  );

  const personalUserId = `context-personal-user-${suffix}`;
  const personalAccountId = `workos-personal:${personalUserId}`;
  const personalTenant: TenantIdentity = {
    userId: personalUserId,
    accountId: personalAccountId,
    accountSource: "workos-personal",
    workspaceId: defaultWorkspaceId(personalAccountId),
    email: `context-personal-${suffix}@example.com`,
    name: "Workspace Context Smoke Personal User",
    role: "owner",
    roles: ["owner"],
    permissions: ["workbench:read"],
    authMode: "workos",
    workspaceSource: "workos-personal",
  };
  requireContext(
    await readJson<WorkspaceContextResponse>("/workspace-context", personalTenant),
    personalTenant,
    "personal context request",
  );

  await assertSessionHidden(tenantB, sessionId, "tenant B");
  await assertDisabledMembership();

  console.log(
    JSON.stringify(
      {
        agentId: first.identity.agentId,
        workspaceId: first.identity.workspaceId,
        workspaceSource: first.identity.workspaceSource,
      },
      null,
      2,
    ),
  );
});

export {};
