import {
  type TenantIdentity,
  createSmokeContext,
  defaultWorkspaceId,
  runSmoke,
} from "./smoke-utils";

type MembershipSummary = {
  role?: string;
  status?: string;
  source?: string;
};

type AdminSummaryResponse = {
  ok?: boolean;
  summary?: {
    identity?: {
      userId?: string;
      workspaceId?: string;
      agentId?: string;
    };
    membership?: MembershipSummary | null;
    externalMembership?: {
      role?: string;
      source?: string;
    } | null;
  };
  error?: string;
};

type WorkspaceMutationResponse = {
  ok?: boolean;
  activeWorkspaceId?: string;
  workspace?: {
    id?: string;
  } | null;
  error?: string;
};

const { baseUrl, suffix, readJson, assertStatus } = createSmokeContext();

const accountId = `workos-org:membership-policy-org-${suffix}`;

const ownerTenant: TenantIdentity = {
  userId: `membership-owner-${suffix}`,
  accountId,
  accountSource: "workos-organization",
  email: `membership-owner-${suffix}@example.com`,
  name: "Membership Policy Smoke Owner",
  role: "member",
  roles: ["member"],
  permissions: ["workbench:read", "workbench:workspace"],
  authMode: "workos",
  workspaceSource: "workos-organization",
};

const memberTenant: TenantIdentity = {
  ...ownerTenant,
  userId: `membership-member-${suffix}`,
  email: `membership-member-${suffix}@example.com`,
  name: "Membership Policy Smoke Member",
  permissions: ["workbench:read"],
};

const adminTenant: TenantIdentity = {
  ...ownerTenant,
  userId: `membership-admin-${suffix}`,
  email: `membership-admin-${suffix}@example.com`,
  name: "Membership Policy Smoke Admin",
  role: "admin",
  roles: ["admin"],
};

const disabledTenant: TenantIdentity = {
  ...ownerTenant,
  userId: `membership-disabled-${suffix}`,
  email: `membership-disabled-${suffix}@example.com`,
  name: "Membership Policy Smoke Disabled User",
  membershipStatus: "disabled",
};

const requireSummary = async (identity: TenantIdentity, label: string) => {
  const body = await readJson<AdminSummaryResponse>("/admin/workspace-summary", identity);
  const summary = body.summary;
  if (!body.ok || !summary?.identity?.workspaceId || !summary.identity.agentId) {
    throw new Error(`${label} did not return a resolved admin summary`);
  }
  if (summary.identity.userId !== identity.userId) {
    throw new Error(`${label} returned the wrong user identity`);
  }
  if (!summary.membership?.role || !summary.membership.status) {
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

const createWorkspace = (identity: TenantIdentity, name: string) =>
  readJson<WorkspaceMutationResponse>("/workspaces", identity, {
    method: "POST",
    body: JSON.stringify({ name }),
  });

runSmoke("Cloudflare membership policy smoke", async () => {
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
});

export {};
