import { NextResponse } from "next/server";

import { toWorkbenchApiError } from "@/lib/workbench/api-errors";
import { getCloudflareAgentBehaviorTemplates } from "@/lib/workbench/cloudflare-control-plane-client";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await getCloudflareAgentBehaviorTemplates());
  } catch (error) {
    return toWorkbenchApiError(error, "Cloudflare agent behavior templates request failed");
  }
}
