import { NextResponse } from "next/server";

import { toWorkbenchApiError } from "@/lib/workbench/api-errors";
import { getCloudflareAgents } from "@/lib/workbench/cloudflare-control-plane-client";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await getCloudflareAgents());
  } catch (error) {
    return toWorkbenchApiError(error, "Cloudflare agents request failed");
  }
}
