import { withAuth } from "@workos-inc/authkit-nextjs";

import type { Id, TenantScope } from "@/lib/agent-framework/contracts";

export type WorkbenchAgentIdentity = {
  scope: TenantScope;
  agentId: Id;
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

  return {
    scope: {
      userId: auth.user.id,
      workspaceId: auth.organizationId,
    },
    agentId: getDevAgentId(),
  };
};
