import { NextResponse, type NextRequest } from "next/server";

import { toWorkbenchApiError } from "@/lib/workbench/api-errors";
import { stageChatSessionThread } from "@/lib/workbench/cloudflare-control-plane-client";

export const runtime = "nodejs";

const allowedSources = new Set([
  "new-session",
  "first-focus",
  "first-draft",
  "first-send",
  "retry",
]);

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const sourceParam = request.nextUrl.searchParams.get("source");
  const source = sourceParam && allowedSources.has(sourceParam) ? sourceParam : "direct";
  try {
    const response = await stageChatSessionThread();
    console.info("workbench.chat_session.stage_thread", {
      durationMs: Date.now() - startedAt,
      ok: true,
      source,
    });
    return NextResponse.json(response);
  } catch (error) {
    console.info("workbench.chat_session.stage_thread", {
      durationMs: Date.now() - startedAt,
      ok: false,
      source,
    });
    return toWorkbenchApiError(error, "Cloudflare chat session staging failed");
  }
}
