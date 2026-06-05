import { withAuth } from "@workos-inc/authkit-nextjs";

import type { Id, TenantScope } from "@/lib/agent-framework/contracts";

export type WorkbenchAgentIdentity = {
  scope: TenantScope;
  agentId?: Id;
  userEmail?: string;
  userName?: string;
  membershipRole?: string;
  membershipRoles?: string[];
  membershipPermissions?: string[];
};

export class WorkbenchAuthError extends Error {
  constructor(
    message: string,
    readonly status = 401,
  ) {
    super(message);
    this.name = "WorkbenchAuthError";
  }
}

const requiredEnv = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
};

const isWorkOsConfigured = () =>
  Boolean(
    process.env.WORKOS_CLIENT_ID?.trim() &&
    process.env.WORKOS_API_KEY?.trim() &&
    process.env.WORKOS_COOKIE_PASSWORD?.trim() &&
    process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI?.trim(),
  );

const getDevAgentId = () => requiredEnv("WORKBENCH_DEV_AGENT_ID");

const getDevAgentIdentity = (): WorkbenchAgentIdentity => ({
  scope: {
    userId: requiredEnv("WORKBENCH_DEV_USER_ID"),
    workspaceId: requiredEnv("WORKBENCH_DEV_WORKSPACE_ID"),
  },
  agentId: getDevAgentId(),
});

export const getWorkbenchAgentIdentity = async (): Promise<WorkbenchAgentIdentity> => {
  if (!isWorkOsConfigured()) return getDevAgentIdentity();

  const auth = await withAuth();
  if (!auth.user) throw new WorkbenchAuthError("Authentication required", 401);
  if (!auth.organizationId) {
    throw new WorkbenchAuthError("WorkOS organization is required before using the workbench", 403);
  }

  const userName = [auth.user.firstName, auth.user.lastName].filter(Boolean).join(" ");

  return {
    scope: {
      userId: auth.user.id,
      workspaceId: auth.organizationId,
    },
    userEmail: auth.user.email,
    userName: userName || auth.user.email || auth.user.id,
    membershipRole: auth.role,
    membershipRoles: auth.roles,
    membershipPermissions: auth.permissions,
  };
};

export const getWorkbenchIdentityHeaders = async () => {
  const identity = await getWorkbenchAgentIdentity();
  const headers: Record<string, string> = {
    "x-assistant-mk1-user-id": identity.scope.userId,
    "x-assistant-mk1-workspace-id": identity.scope.workspaceId,
  };

  if (identity.agentId) headers["x-assistant-mk1-agent-id"] = identity.agentId;
  if (identity.userEmail) headers["x-assistant-mk1-user-email"] = identity.userEmail;
  if (identity.userName) headers["x-assistant-mk1-user-name"] = identity.userName;
  if (identity.membershipRole) headers["x-assistant-mk1-membership-role"] = identity.membershipRole;
  if (identity.membershipRoles) {
    headers["x-assistant-mk1-membership-roles"] = JSON.stringify(identity.membershipRoles);
  }
  if (identity.membershipPermissions) {
    headers["x-assistant-mk1-membership-permissions"] = JSON.stringify(
      identity.membershipPermissions,
    );
  }

  return headers;
};
