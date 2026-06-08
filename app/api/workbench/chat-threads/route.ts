import { NextResponse, type NextRequest } from "next/server";

import { toWorkbenchApiError } from "@/lib/workbench/api-errors";
import { getChatThreads } from "@/lib/workbench/cloudflare-control-plane-client";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 30);
    return NextResponse.json(await getChatThreads(Number.isFinite(limit) ? limit : 30));
  } catch (error) {
    return toWorkbenchApiError(error, "Cloudflare chat threads request failed");
  }
}
