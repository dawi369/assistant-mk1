import { getWorkbenchAgentIdentity, WorkbenchAuthError } from "@/lib/workbench/agent-identity";

export type WorkbenchAdminAccess = {
  ok: true;
  isAdmin: boolean;
};

const parseAllowlist = (value: string | undefined, normalize = (item: string) => item) =>
  new Set(
    (value ?? "")
      .split(",")
      .map((item) => normalize(item.trim()))
      .filter(Boolean),
  );

export const getWorkbenchAdminAccess = async (): Promise<WorkbenchAdminAccess> => {
  const identity = await getWorkbenchAgentIdentity();
  const allowedUserIds = parseAllowlist(process.env.WORKBENCH_ADMIN_USER_IDS);
  const allowedEmails = parseAllowlist(process.env.WORKBENCH_ADMIN_EMAILS, (item) =>
    item.toLowerCase(),
  );
  const userEmail = identity.userEmail?.toLowerCase();

  return {
    ok: true,
    isAdmin:
      allowedUserIds.has(identity.scope.userId) ||
      (userEmail ? allowedEmails.has(userEmail) : false),
  };
};

export const requireWorkbenchAdminAccess = async () => {
  const access = await getWorkbenchAdminAccess();
  if (!access.isAdmin) throw new WorkbenchAuthError("Admin access is restricted", 403);
  return access;
};
