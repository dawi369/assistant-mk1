import { type NextRequest } from "next/server";

import { updateCloudflareWorkspaceMember } from "@/lib/workbench/cloudflare-control-plane-client";
import { workbenchJson } from "@/lib/workbench/route-handler";

export const runtime = "nodejs";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; userId: string }> },
) {
  const [{ workspaceId, userId }, body] = await Promise.all([
    params,
    request.json().catch(() => ({})) as Promise<{ role?: unknown; status?: unknown }>,
  ]);
  const role = body.role;
  const status = body.status;
  if (
    (role !== "owner" && role !== "admin" && role !== "member") ||
    (status !== "active" && status !== "disabled")
  ) {
    return Response.json(
      { ok: false, error: "A valid membership role and status are required" },
      { status: 400 },
    );
  }
  return workbenchJson(
    () => updateCloudflareWorkspaceMember(workspaceId, userId, { role, status }),
    "Cloudflare workspace member update failed",
  );
}
