import { NextResponse, type NextRequest } from "next/server";

import { toWorkbenchApiError } from "@/lib/workbench/api-errors";
import { getChatThread } from "@/lib/workbench/cloudflare-control-plane-client";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  try {
    const { threadId } = await params;
    return NextResponse.json(await getChatThread(threadId));
  } catch (error) {
    return toWorkbenchApiError(error, "Cloudflare chat thread request failed");
  }
}
