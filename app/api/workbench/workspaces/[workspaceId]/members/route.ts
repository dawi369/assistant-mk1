import { type NextRequest } from "next/server";

import {
  addCloudflareWorkspaceMember,
  getCloudflareWorkspaceMembers,
} from "@/lib/workbench/cloudflare-control-plane-client";
import { workbenchJson } from "@/lib/workbench/route-handler";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await params;
  return workbenchJson(
    () => getCloudflareWorkspaceMembers(workspaceId),
    "Cloudflare workspace members request failed",
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const [{ workspaceId }, body] = await Promise.all([
    params,
    request.json().catch(() => ({})) as Promise<{ userId?: unknown; role?: unknown }>,
  ]);
  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  const role = body.role;
  if (!userId || (role !== "owner" && role !== "admin" && role !== "member")) {
    return Response.json(
      { ok: false, error: "A valid account member and role are required" },
      { status: 400 },
    );
  }
  return workbenchJson(
    () => addCloudflareWorkspaceMember(workspaceId, { userId, role }),
    "Cloudflare workspace member creation failed",
    { status: 201 },
  );
}
