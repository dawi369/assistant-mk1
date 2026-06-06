import { NextResponse, type NextRequest } from "next/server";

import { toWorkbenchApiError } from "@/lib/workbench/api-errors";
import { activateCloudflareWorkspace } from "@/lib/workbench/cloudflare-control-plane-client";

export const runtime = "nodejs";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const { workspaceId } = await params;
    return NextResponse.json(await activateCloudflareWorkspace(workspaceId));
  } catch (error) {
    return toWorkbenchApiError(error, "Cloudflare workspace activation failed");
  }
}
