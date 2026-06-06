import { NextResponse, type NextRequest } from "next/server";

import { toWorkbenchApiError } from "@/lib/workbench/api-errors";
import { activateCloudflareAgent } from "@/lib/workbench/cloudflare-control-plane-client";

export const runtime = "nodejs";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  try {
    const { agentId } = await params;
    return NextResponse.json(await activateCloudflareAgent(agentId));
  } catch (error) {
    return toWorkbenchApiError(error, "Cloudflare agent activation failed");
  }
}
