import { NextResponse, type NextRequest } from "next/server";

import { toWorkbenchApiError } from "@/lib/workbench/api-errors";
import { updateChatSessionThread } from "@/lib/workbench/cloudflare-control-plane-client";
import type { ChatThreadStatus } from "@/lib/workbench/workbench-types";

export const runtime = "nodejs";

const validStatuses = new Set<ChatThreadStatus>(["active", "archived", "deleted"]);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  try {
    const { threadId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      title?: unknown;
      status?: unknown;
      fallbackTitle?: unknown;
    };
    const status =
      typeof body.status === "string" && validStatuses.has(body.status as ChatThreadStatus)
        ? (body.status as ChatThreadStatus)
        : undefined;
    const title = typeof body.title === "string" ? body.title : undefined;
    const fallbackTitle = typeof body.fallbackTitle === "string" ? body.fallbackTitle : undefined;

    return NextResponse.json(
      await updateChatSessionThread(threadId, { title, status, fallbackTitle }),
    );
  } catch (error) {
    return toWorkbenchApiError(error, "Cloudflare chat session thread update failed");
  }
}
