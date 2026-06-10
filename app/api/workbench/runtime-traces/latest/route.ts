import { NextResponse } from "next/server";

import { toWorkbenchApiError } from "@/lib/workbench/api-errors";
import { getLatestRuntimeTraces } from "@/lib/workbench/cloudflare-control-plane-client";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") ?? 10);
    return NextResponse.json(await getLatestRuntimeTraces(limit));
  } catch (error) {
    return toWorkbenchApiError(error, "Cloudflare runtime traces request failed");
  }
}
