import { NextResponse } from "next/server";

import { toWorkbenchApiError } from "@/lib/workbench/api-errors";
import { getLatestCloudflareOwnedDemoRunSnapshot } from "@/lib/workbench/cloudflare-control-plane-client";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await getLatestCloudflareOwnedDemoRunSnapshot());
  } catch (error) {
    return toWorkbenchApiError(error, "Cloudflare demo request failed");
  }
}
