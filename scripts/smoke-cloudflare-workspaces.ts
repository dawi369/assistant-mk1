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
  authMode?: string;
  workspaceSource?: string;
};

type WorkspaceSummary = {
  id?: string;
  name?: string;
  status?: string;
  isDefault?: boolean;
  isActive?: boolean;
};

type WorkspacesResponse = {
  ok?: boolean;
  activeWorkspaceId?: string;
  workspaces?: WorkspaceSummary[];
  error?: string;
};

type WorkspaceMutationResponse = {
  ok?: boolean;
  activeWorkspaceId?: string;
  workspace?: WorkspaceSummary | null;
  defaultAgent?: {
    id?: string;
  } | null;
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
    account?: {
      id?: string;
      source?: string;
    } | null;
    workspace?: WorkspaceSummary | null;
    workspaces?: WorkspaceSummary[];
    defaultAgent?: {
      id?: string;
      status?: string;
      isDefault?: boolean;
    } | null;
  };
  error?: string;
};

const baseUrl = (process.env.CLOUDFLARE_CONTROL_PLANE_URL ?? "http://localhost:8787").replace(
  /\/$/,
  "",
);
const token = process.env.CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN ?? "local-dev-token";
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const defaultWorkspaceId = (accountId: string) => `workspace:${accountId}:default`;
const accountId = `workos-org:workspaces-org-${suffix}`;
const defaultWorkspace = defaultWorkspaceId(accountId);

const tenant: TenantIdentity = {
  userId: `workspaces-user-${suffix}`,
  accountId,
  accountSource: "workos-organization",
  email: `workspaces-${suffix}@example.com`,
  name: "Workspace Management Smoke User",
  role: "owner",
  roles: ["owner"],
  permissions: ["workbench:read", "workbench:workspace"],
  authMode: "workos",
  workspaceSource: "workos-organization",
};

const tenantB: TenantIdentity = {
  ...tenant,
  userId: `workspaces-user-b-${suffix}`,
  accountId: `workos-org:workspaces-org-b-${suffix}`,
  email: `workspaces-b-${suffix}@example.com`,
  name: "Workspace Management Smoke User B",
};

const disabledTenant: TenantIdentity = {
  ...tenant,
  userId: `workspaces-disabled-user-${suffix}`,
  accountId: `workos-org:workspaces-disabled-org-${suffix}`,
  email: `workspaces-disabled-${suffix}@example.com`,
  name: "Workspace Management Smoke Disabled User",
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
  if (identity.authMode) headers["x-assistant-mk1-auth-mode"] = identity.authMode;
  if (identity.workspaceSource) {
    headers["x-assistant-mk1-workspace-source"] = identity.workspaceSource;
  }

  return headers;
};

const readJson = async <T>(
  path: string,
  identity: TenantIdentity = tenant,
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
  if (summary.identity.userId !== tenant.userId) {
    throw new Error(`${label} returned the wrong user identity`);
  }
  if (summary.account?.id !== tenant.accountId || summary.account.source !== tenant.accountSource) {
    throw new Error(`${label} returned the wrong account identity`);
  }
  if (!summary.defaultAgent?.id || !summary.defaultAgent.isDefault) {
    throw new Error(`${label} did not return a default agent`);
  }
  return summary;
};

const assertDisabledMembership = async () => {
  const response = await fetch(`${baseUrl}/workspaces`, {
    headers: headersFor(disabledTenant),
  });
  if (response.status !== 403) {
    throw new Error(`disabled membership workspace list expected 403, got ${response.status}`);
  }
};

const assertCrossAccountActivationHidden = async (workspaceId: string) => {
  const response = await fetch(
    `${baseUrl}/workspaces/${encodeURIComponent(workspaceId)}/activate`,
    {
      method: "POST",
      headers: headersFor(tenantB),
    },
  );
  if (response.status !== 404) {
    throw new Error(`cross-account activation expected 404, got ${response.status}`);
  }
};

const main = async () => {
  console.log(`Smoking Cloudflare workspaces at ${baseUrl}`);

  const initial = requireSummary(
    await readJson<AdminSummaryResponse>("/admin/workspace-summary"),
    "initial admin summary",
  );
  if (initial.identity?.workspaceId !== defaultWorkspace || !initial.workspace?.isDefault) {
    throw new Error("initial request did not resolve the account default workspace");
  }

  const firstList = await readJson<WorkspacesResponse>("/workspaces");
  if (!firstList.ok || firstList.activeWorkspaceId !== defaultWorkspace) {
    throw new Error("workspace list did not mark the default workspace active");
  }
  if (!firstList.workspaces?.some((workspace) => workspace.id === defaultWorkspace)) {
    throw new Error("workspace list did not include the default workspace");
  }

  const createdName = `Smoke Workspace ${suffix}`;
  const created = await readJson<WorkspaceMutationResponse>("/workspaces", tenant, {
    method: "POST",
    body: JSON.stringify({ name: createdName }),
  });
  const createdWorkspaceId = created.workspace?.id;
  if (!created.ok || !createdWorkspaceId || created.activeWorkspaceId !== createdWorkspaceId) {
    throw new Error(created.error ?? "workspace creation did not activate the new workspace");
  }

  const afterCreate = requireSummary(
    await readJson<AdminSummaryResponse>("/admin/workspace-summary"),
    "created workspace admin summary",
  );
  if (
    afterCreate.identity?.workspaceId !== createdWorkspaceId ||
    afterCreate.workspace?.name !== createdName ||
    !afterCreate.workspace.isActive
  ) {
    throw new Error("admin summary did not resolve the newly active workspace");
  }
  const createdAgentId = afterCreate.identity.agentId;

  const repeated = requireSummary(
    await readJson<AdminSummaryResponse>("/admin/workspace-summary"),
    "repeated admin summary",
  );
  if (
    repeated.identity?.workspaceId !== createdWorkspaceId ||
    repeated.identity.agentId !== createdAgentId
  ) {
    throw new Error("active workspace or default agent changed between repeated summaries");
  }

  await assertCrossAccountActivationHidden(createdWorkspaceId);

  const activatedDefault = await readJson<WorkspaceMutationResponse>(
    `/workspaces/${encodeURIComponent(defaultWorkspace)}/activate`,
    tenant,
    { method: "POST" },
  );
  if (!activatedDefault.ok || activatedDefault.activeWorkspaceId !== defaultWorkspace) {
    throw new Error("default workspace activation failed");
  }

  const afterActivate = requireSummary(
    await readJson<AdminSummaryResponse>("/admin/workspace-summary"),
    "default reactivation admin summary",
  );
  if (
    afterActivate.identity?.workspaceId !== defaultWorkspace ||
    !afterActivate.workspace?.isDefault
  ) {
    throw new Error("admin summary did not switch back to the default workspace");
  }

  await assertDisabledMembership();

  console.log("Cloudflare workspaces smoke passed");
  console.log(
    JSON.stringify(
      {
        accountId,
        defaultWorkspace,
        createdWorkspaceId,
        createdAgentId,
        activeWorkspaceId: afterActivate.identity?.workspaceId,
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
