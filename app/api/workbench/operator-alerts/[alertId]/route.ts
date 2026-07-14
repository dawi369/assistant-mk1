import { NextResponse, type NextRequest } from "next/server";

import { toWorkbenchApiError } from "@/lib/workbench/api-errors";
import { updateCloudflareOperatorAlert } from "@/lib/workbench/cloudflare-control-plane-client";

export const runtime = "nodejs";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ alertId: string }> },
) {
  try {
    const { alertId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { status?: unknown };
    if (body.status !== "acknowledged" && body.status !== "resolved") {
      return NextResponse.json(
        { ok: false, error: "Alert status must be acknowledged or resolved." },
        { status: 400 },
      );
    }
    return NextResponse.json(await updateCloudflareOperatorAlert(alertId, body.status));
  } catch (error) {
    return toWorkbenchApiError(error, "Cloudflare operator alert update failed");
  }
}
