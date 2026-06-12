import { NextResponse } from "next/server";

import { toWorkbenchApiError } from "@/lib/workbench/api-errors";
import { getChatSession } from "@/lib/workbench/cloudflare-control-plane-client";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await getChatSession());
  } catch (error) {
    return toWorkbenchApiError(error, "Cloudflare chat session request failed");
  }
}
