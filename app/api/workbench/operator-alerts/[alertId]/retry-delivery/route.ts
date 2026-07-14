import { NextResponse } from "next/server";

import { toWorkbenchApiError } from "@/lib/workbench/api-errors";
import { retryCloudflareOperatorAlertDelivery } from "@/lib/workbench/cloudflare-control-plane-client";

export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ alertId: string }> }) {
  try {
    const { alertId } = await context.params;
    return NextResponse.json(await retryCloudflareOperatorAlertDelivery(alertId));
  } catch (error) {
    return toWorkbenchApiError(error, "Cloudflare operator alert delivery retry failed");
  }
}
