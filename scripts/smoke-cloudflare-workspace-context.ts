type TenantIdentity = {
  userId: string;
  accountId: string;
  accountSource: string;
  workspaceId: string;
  email?: string;
  name?: string;
  role?: string;
  roles?: string[];
  permissions?: string[];
  membershipStatus?: string;
  authMode?: string;
  workspaceSource?: string;
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
      email?: string | null;
      displayName?: string | null;
      status?: string;
    } | null;
    workspace?: {
      status?: string;
      isDefault?: boolean;
    } | null;
    membership?: {
      role?: string;
      status?: string;
      roles?: string[];
      permissions?: string[];
    } | null;
    agent?: {
      id?: string;
      status?: string;
      isDefault?: boolean;
    } | null;
  };
  error?: string;
};

type SessionResponse = {
  ok?: boolean;
  session?: {
    sessionId?: string;
    scope?: {
      userId?: string;
      workspaceId?: string;
    };
  } | null;
};

const baseUrl = (process.env.CLOUDFLARE_CONTROL_PLANE_URL ?? "http://localhost:8787").replace(
  /\/$/,
  "",
);
const token = process.env.CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN ?? "local-dev-token";
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const defaultWorkspaceId = (accountId: string) => `workspace:${accountId}:default`;

const tenantA: TenantIdentity = {
  userId: `context-user-a-${suffix}`,
  accountId: `workos-org:context-org-a-${suffix}`,
  accountSource: "workos-organization",
  workspaceId: defaultWorkspaceId(`workos-org:context-org-a-${suffix}`),
  email: `context-a-${suffix}@example.com`,
  name: "Workspace Context Smoke User A",
  role: "owner",
  roles: ["owner"],
  permissions: ["workbench:read", "workbench:demo"],
  authMode: "workos",
  workspaceSource: "workos-organization",
};

const tenantB: TenantIdentity = {
  ...tenantA,
  userId: `context-user-b-${suffix}`,
  accountId: `workos-org:context-org-b-${suffix}`,
  accountSource: "workos-organization",
  workspaceId: defaultWorkspaceId(`workos-org:context-org-b-${suffix}`),
  email: `context-b-${suffix}@example.com`,
  name: "Workspace Context Smoke User B",
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

const headersFor = (identity: TenantIdentity) => {
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-assistant-mk1-user-id": identity.userId,
    "x-assistant-mk1-account-id": identity.accountId,
    "x-assistant-mk1-account-source": identity.accountSource,
    "x-assistant-mk1-workspace-id": identity.workspaceId,
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
  if (identity.authMode) headers["x-assistant-mk1-auth-mode"] = identity.authMode;
  if (identity.workspaceSource) {
    headers["x-assistant-mk1-workspace-source"] = identity.workspaceSource;
  }

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

const requireContext = (
  body: WorkspaceContextResponse,
  identity: TenantIdentity,
  label: string,
) => {
  const context = body.context;
  if (!body.ok || !context?.identity.agentId) {
    throw new Error(`${label} did not return a resolved workspace context`);
  }
  if (
    context.identity.userId !== identity.userId ||
    context.identity.workspaceId !== identity.workspaceId
  ) {
    throw new Error(`${label} returned the wrong tenant identity`);
  }
  if (context.identity.authMode !== identity.authMode) {
    throw new Error(`${label} returned authMode ${context.identity.authMode}`);
  }
  if (context.identity.workspaceSource !== identity.workspaceSource) {
    throw new Error(`${label} returned workspaceSource ${context.identity.workspaceSource}`);
  }
  if (
    context.account?.id !== identity.accountId ||
    context.account.source !== identity.accountSource
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
    headers: headersFor(disabledTenant),
  });
  if (response.status !== 403) {
    throw new Error(`disabled membership context expected 403, got ${response.status}`);
  }
};

const assertSessionHidden = async (identity: TenantIdentity, sessionId: string, label: string) => {
  const response = await fetch(`${baseUrl}/sessions/${encodeURIComponent(sessionId)}`, {
    headers: headersFor(identity),
  });
  if (response.status !== 404) {
    throw new Error(
      `${label} expected cross-workspace session read to return 404, got ${response.status}`,
    );
  }
};

const main = async () => {
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

  console.log("Cloudflare workspace context smoke passed");
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
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

export {};
