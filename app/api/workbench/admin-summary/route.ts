import { NextResponse } from "next/server";

import { toWorkbenchApiError } from "@/lib/workbench/api-errors";
import { getCloudflareAdminSummary } from "@/lib/workbench/cloudflare-control-plane-client";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await getCloudflareAdminSummary());
  } catch (error) {
    return toWorkbenchApiError(error, "Cloudflare admin summary request failed");
  }
}
