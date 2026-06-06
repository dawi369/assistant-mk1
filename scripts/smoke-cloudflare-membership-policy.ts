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
    membership?: {
      source?: string;
      role?: string;
      status?: string;
      roles?: string[];
      permissions?: string[];
    } | null;
    externalMembership?: {
      source?: string;
      role?: string | null;
      status?: string | null;
      roles?: string[];
      permissions?: string[];
    } | null;
  };
  error?: string;
};

type WorkspaceMutationResponse = {
  ok?: boolean;
  activeWorkspaceId?: string;
  workspace?: {
    id?: string;
    name?: string;
  } | null;
  error?: string;
};

const baseUrl = (process.env.CLOUDFLARE_CONTROL_PLANE_URL ?? "http://localhost:8787").replace(
  /\/$/,
  "",
);
const token = process.env.CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN ?? "local-dev-token";
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const defaultWorkspaceId = (accountId: string) => `workspace:${accountId}:default`;
const accountId = `workos-org:membership-policy-org-${suffix}`;

const ownerTenant: TenantIdentity = {
  userId: `membership-owner-${suffix}`,
  accountId,
  accountSource: "workos-organization",
  email: `membership-owner-${suffix}@example.com`,
  name: "Membership Policy Owner",
  role: "member",
  roles: ["member"],
  permissions: ["workbench:read"],
  authMode: "workos",
  workspaceSource: "workos-organization",
};

const memberTenant: TenantIdentity = {
  userId: `membership-member-${suffix}`,
  accountId,
  accountSource: "workos-organization",
  email: `membership-member-${suffix}@example.com`,
  name: "Membership Policy Member",
  role: "member",
  roles: ["member"],
  permissions: ["workbench:read"],
  authMode: "workos",
  workspaceSource: "workos-organization",
};

const adminTenant: TenantIdentity = {
  userId: `membership-admin-${suffix}`,
  accountId,
  accountSource: "workos-organization",
  email: `membership-admin-${suffix}@example.com`,
  name: "Membership Policy Admin",
  role: "admin",
  roles: ["admin"],
  permissions: ["workbench:read", "workbench:workspace"],
  authMode: "workos",
  workspaceSource: "workos-organization",
};

const disabledAccountId = `workos-org:membership-disabled-org-${suffix}`;
const disabledTenant: TenantIdentity = {
  userId: `membership-disabled-${suffix}`,
  accountId: disabledAccountId,
  accountSource: "workos-organization",
  email: `membership-disabled-${suffix}@example.com`,
  name: "Membership Policy Disabled",
  role: "member",
  roles: ["member"],
  permissions: ["workbench:read"],
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

const requireSummary = async (identity: TenantIdentity, label: string) => {
  const body = await readJson<AdminSummaryResponse>("/admin/workspace-summary", identity);
  const summary = body.summary;
  if (!body.ok || !summary?.identity?.agentId || !summary.membership) {
    throw new Error(`${label} did not return a resolved membership summary`);
  }
  if (summary.membership.source !== "cloudflare-d1") {
    throw new Error(`${label} did not mark D1 as the membership source`);
  }
  if (summary.externalMembership?.source !== "workos-headers") {
    throw new Error(`${label} did not expose the external WorkOS membership signal`);
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

const createWorkspace = (identity: TenantIdentity, name: string) =>
  readJson<WorkspaceMutationResponse>("/workspaces", identity, {
    method: "POST",
    body: JSON.stringify({ name }),
  });

const main = async () => {
  console.log(`Smoking Cloudflare membership policy at ${baseUrl}`);

  const ownerSummary = await requireSummary(ownerTenant, "first owner summary");
  if (ownerSummary.membership?.role !== "owner" || ownerSummary.membership.status !== "active") {
    throw new Error("first account member was not bootstrapped as active owner");
  }
  if (ownerSummary.externalMembership?.role !== "member") {
    throw new Error("external WorkOS role signal was not preserved for owner bootstrap");
  }

  const ownerWorkspace = await createWorkspace(ownerTenant, `Owner Workspace ${suffix}`);
  const ownerWorkspaceId = ownerWorkspace.workspace?.id;
  if (!ownerWorkspace.ok || !ownerWorkspaceId) {
    throw new Error(ownerWorkspace.error ?? "owner workspace creation failed");
  }

  const memberSummary = await requireSummary(memberTenant, "member summary");
  if (memberSummary.membership?.role !== "member" || memberSummary.membership.status !== "active") {
    throw new Error("later account member was not bootstrapped as active member");
  }
  await assertStatus("/workspaces", memberTenant, 403, {
    method: "POST",
    body: JSON.stringify({ name: "Member Blocked Workspace" }),
  });
  await assertStatus(
    `/workspaces/${encodeURIComponent(ownerWorkspaceId)}/activate`,
    memberTenant,
    403,
    { method: "POST" },
  );

  const adminSummary = await requireSummary(adminTenant, "admin summary");
  if (adminSummary.membership?.role !== "admin" || adminSummary.membership.status !== "active") {
    throw new Error("external admin role was not seeded as a D1 admin membership");
  }
  const adminWorkspace = await createWorkspace(adminTenant, `Admin Workspace ${suffix}`);
  if (!adminWorkspace.ok || !adminWorkspace.workspace?.id) {
    throw new Error(adminWorkspace.error ?? "admin workspace creation failed");
  }

  await assertStatus("/admin/workspace-summary", disabledTenant, 403);
  await assertStatus(
    "/admin/workspace-summary",
    { ...disabledTenant, membershipStatus: "active" },
    403,
  );

  console.log("Cloudflare membership policy smoke passed");
  console.log(
    JSON.stringify(
      {
        accountId,
        defaultWorkspaceId: defaultWorkspaceId(accountId),
        ownerWorkspaceId,
        adminWorkspaceId: adminWorkspace.workspace.id,
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
