import { NextResponse, type NextRequest } from "next/server";

import { toWorkbenchApiError } from "@/lib/workbench/api-errors";
import { requireWorkbenchAdminAccess } from "@/lib/workbench/admin-access";
import { instantiateCloudflareAgentPack } from "@/lib/workbench/cloudflare-control-plane-client";

export const runtime = "nodejs";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ packId: string }> },
) {
  try {
    await requireWorkbenchAdminAccess();
    const { packId } = await params;
    const result = await instantiateCloudflareAgentPack(packId);
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    return toWorkbenchApiError(error, "Agent pack activation failed");
  }
}
