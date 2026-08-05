import { getWorkOS } from "@workos-inc/authkit-nextjs";

import { toWorkbenchApiError } from "@/lib/workbench/api-errors";
import { getWorkbenchAgentIdentity } from "@/lib/workbench/agent-identity";
import type { WorkbenchAccountContextResponse } from "@/lib/workbench/workbench-types";

export const runtime = "nodejs";

export async function GET() {
  try {
    const identity = await getWorkbenchAgentIdentity();
    if (identity.authMode === "local-dev") {
      return Response.json({
        ok: true,
        currentAccountId: identity.accountId,
        accounts: [
          {
            id: identity.accountId,
            name: "Local development",
            source: "local-dev",
            role: "owner",
            roles: ["owner"],
            isCurrent: true,
          },
        ],
      } satisfies WorkbenchAccountContextResponse);
    }

    const organizationMemberships = await getWorkOS().userManagement.listOrganizationMemberships({
      userId: identity.scope.userId,
      statuses: ["active"],
      limit: 100,
    });
    const accounts: NonNullable<WorkbenchAccountContextResponse["accounts"]> =
      organizationMemberships.data.map((membership) => ({
        id: `workos-org:${membership.organizationId}`,
        organizationId: membership.organizationId,
        name: membership.organizationName,
        source: "workos-organization" as const,
        role: membership.role?.slug,
        roles: membership.roles?.map((role) => role.slug),
        isCurrent: membership.organizationId === identity.organizationId,
      }));

    if (!identity.organizationId) {
      accounts.unshift({
        id: `workos-personal:${identity.scope.userId}`,
        organizationId: undefined,
        name: "Personal",
        source: "workos-personal",
        role: "owner",
        roles: ["owner"],
        isCurrent: true,
      });
    }

    return Response.json({
      ok: true,
      currentAccountId: identity.accountId,
      currentOrganizationId: identity.organizationId,
      accounts,
    } satisfies WorkbenchAccountContextResponse);
  } catch (error) {
    return toWorkbenchApiError(error, "Failed to load account context");
  }
}
