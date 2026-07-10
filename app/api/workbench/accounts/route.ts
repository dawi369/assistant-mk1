import { getWorkOS, withAuth } from "@workos-inc/authkit-nextjs";

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

    const auth = await withAuth({ ensureSignedIn: true });
    const organizationMemberships = await getWorkOS().userManagement.listOrganizationMemberships({
      userId: auth.user.id,
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
        isCurrent: membership.organizationId === auth.organizationId,
      }));

    if (!auth.organizationId) {
      accounts.unshift({
        id: `workos-personal:${auth.user.id}`,
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
      currentOrganizationId: auth.organizationId,
      accounts,
    } satisfies WorkbenchAccountContextResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load account context";
    const status = message === "Authentication required" ? 401 : 502;
    return Response.json({ ok: false, error: message }, { status });
  }
}
