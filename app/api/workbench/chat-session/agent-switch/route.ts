import { NextResponse, type NextRequest } from "next/server";

import { toWorkbenchApiError } from "@/lib/workbench/api-errors";
import { switchChatSessionAgent } from "@/lib/workbench/cloudflare-control-plane-client";
import type { AgentSwitchTarget } from "@/lib/workbench/workbench-types";

export const runtime = "nodejs";

const normalizeAgentSwitchTarget = (target: unknown): AgentSwitchTarget =>
  target === "new_thread" ? "new_thread" : "current_thread";

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
        target: normalizeAgentSwitchTarget(body.target),
        threadId: typeof body.threadId === "string" ? body.threadId : undefined,
      }),
    );
  } catch (error) {
    return toWorkbenchApiError(error, "Cloudflare agent switch request failed");
  }
}
