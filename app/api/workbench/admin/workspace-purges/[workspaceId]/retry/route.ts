import { type NextRequest } from "next/server";

import { requireWorkbenchAdminAccess } from "@/lib/workbench/admin-access";
import { retryCloudflareWorkspaceDeletionAsOperator } from "@/lib/workbench/cloudflare-control-plane-client";
import { workbenchJson } from "@/lib/workbench/route-handler";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return workbenchJson(
    async () => {
      await requireWorkbenchAdminAccess();
      return retryCloudflareWorkspaceDeletionAsOperator(workspaceId, {
        workspaceName: typeof body.workspaceName === "string" ? body.workspaceName : "",
        reason: typeof body.reason === "string" ? body.reason : "",
      });
    },
    "Platform workspace purge retry failed",
    { status: 202 },
  );
}
