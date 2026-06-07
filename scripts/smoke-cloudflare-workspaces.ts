import {
  type TenantIdentity,
  createSmokeContext,
  defaultWorkspaceId,
  runSmoke,
} from "./smoke-utils";

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

const { baseUrl, suffix, headersFor, readJson } = createSmokeContext();

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

const requireSummary = (body: AdminSummaryResponse, label: string) => {
  const summary = body.summary;
  if (!body.ok || !summary?.identity?.workspaceId || !summary.identity.agentId) {
    throw new Error(`${label} did not return a resolved admin summary`);
  }
  if (summary.identity.userId !== tenant.userId) {
    throw new Error(`${label} returned the wrong user identity`);
  }
  if (
    summary.account?.id !== tenant.accountId ||
    summary.account?.source !== tenant.accountSource
  ) {
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

runSmoke("Cloudflare workspaces smoke", async () => {
  console.log(`Smoking Cloudflare workspaces at ${baseUrl}`);

  const initial = requireSummary(
    await readJson<AdminSummaryResponse>("/admin/workspace-summary", tenant),
    "initial admin summary",
  );
  if (initial.identity?.workspaceId !== defaultWorkspace || !initial.workspace?.isDefault) {
    throw new Error("initial request did not resolve the account default workspace");
  }

  const firstList = await readJson<WorkspacesResponse>("/workspaces", tenant);
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
    await readJson<AdminSummaryResponse>("/admin/workspace-summary", tenant),
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
    await readJson<AdminSummaryResponse>("/admin/workspace-summary", tenant),
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
    await readJson<AdminSummaryResponse>("/admin/workspace-summary", tenant),
    "default reactivation admin summary",
  );
  if (
    afterActivate.identity?.workspaceId !== defaultWorkspace ||
    !afterActivate.workspace?.isDefault
  ) {
    throw new Error("admin summary did not switch back to the default workspace");
  }

  await assertDisabledMembership();

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
});

export {};
