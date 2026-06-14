import { NextResponse, type NextRequest } from "next/server";

import { toWorkbenchApiError } from "@/lib/workbench/api-errors";
import { denyCloudflareToolApproval } from "@/lib/workbench/cloudflare-control-plane-client";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ approvalRequestId: string }> },
) {
  try {
    const { approvalRequestId } = await params;
    const body = (await request.json().catch(() => ({}))) as { reason?: unknown };
    return NextResponse.json(
      await denyCloudflareToolApproval(approvalRequestId, {
        reason: typeof body.reason === "string" ? body.reason : undefined,
      }),
    );
  } catch (error) {
    return toWorkbenchApiError(error, "Cloudflare tool denial failed");
  }
}
