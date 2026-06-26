import { NextResponse, type NextRequest } from "next/server";

import { toWorkbenchApiError } from "@/lib/workbench/api-errors";
import { switchChatSessionAgent } from "@/lib/workbench/cloudflare-control-plane-client";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      agentId?: unknown;
      target?: unknown;
      threadId?: unknown;
    };
    if (typeof body.agentId !== "string" || !body.agentId.trim()) {
      return NextResponse.json({ ok: false, error: "agentId is required" }, { status: 400 });
    }
    return NextResponse.json(
      await switchChatSessionAgent({
        agentId: body.agentId,
        target: body.target === "new_thread" ? "new_thread" : "current_thread",
        threadId: typeof body.threadId === "string" ? body.threadId : undefined,
      }),
    );
  } catch (error) {
    return toWorkbenchApiError(error, "Cloudflare agent switch request failed");
  }
}
