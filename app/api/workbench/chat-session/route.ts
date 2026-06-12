import { NextResponse, type NextRequest } from "next/server";

import { toWorkbenchApiError } from "@/lib/workbench/api-errors";
import { getChatSession } from "@/lib/workbench/cloudflare-control-plane-client";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const refresh =
      request.nextUrl.searchParams.get("refresh") === "threads" ? "threads" : undefined;
    return NextResponse.json(await getChatSession({ refresh }));
  } catch (error) {
    return toWorkbenchApiError(error, "Cloudflare chat session request failed");
  }
}
