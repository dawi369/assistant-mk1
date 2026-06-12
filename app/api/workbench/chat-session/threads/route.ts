import { NextResponse } from "next/server";

import { toWorkbenchApiError } from "@/lib/workbench/api-errors";
import { createChatSessionThread } from "@/lib/workbench/cloudflare-control-plane-client";

export const runtime = "nodejs";

export async function POST() {
  try {
    return NextResponse.json(await createChatSessionThread());
  } catch (error) {
    return toWorkbenchApiError(error, "Cloudflare chat session thread creation failed");
  }
}
