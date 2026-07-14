import { NextResponse, type NextRequest } from "next/server";

import { toWorkbenchApiError } from "@/lib/workbench/api-errors";
import { getCloudflareOperatorAlerts } from "@/lib/workbench/cloudflare-control-plane-client";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 25);
  try {
    return NextResponse.json(await getCloudflareOperatorAlerts(limit));
  } catch (error) {
    return toWorkbenchApiError(error, "Cloudflare operator alert list failed");
  }
}
