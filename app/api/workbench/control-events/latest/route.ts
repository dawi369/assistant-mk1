import { NextResponse } from "next/server";

import { toWorkbenchApiError } from "@/lib/workbench/api-errors";
import { getLatestControlPlaneEvents } from "@/lib/workbench/cloudflare-control-plane-client";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await getLatestControlPlaneEvents(25));
  } catch (error) {
    return toWorkbenchApiError(error, "Cloudflare event request failed");
  }
}
