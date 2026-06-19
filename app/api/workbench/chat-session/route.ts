import { NextResponse, type NextRequest } from "next/server";

import { toWorkbenchApiError } from "@/lib/workbench/api-errors";
import { getChatSession } from "@/lib/workbench/cloudflare-control-plane-client";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  const refresh = request.nextUrl.searchParams.get("refresh") === "threads" ? "threads" : undefined;
  const sourceParam = request.nextUrl.searchParams.get("source");
  const source =
    sourceParam === "new-session" ||
    sourceParam === "first-draft" ||
    sourceParam === "stream-open" ||
    sourceParam === "post-action" ||
    sourceParam === "post-delete" ||
    sourceParam === "post-materialize" ||
    sourceParam === "manual"
      ? sourceParam
      : "direct";
  try {
    const response = await getChatSession({ refresh });
    console.info("workbench.chat_session.get", {
      durationMs: Date.now() - startedAt,
      ok: true,
      refresh: refresh ?? "default",
      source,
    });
    return NextResponse.json(response);
  } catch (error) {
    console.info("workbench.chat_session.get", {
      durationMs: Date.now() - startedAt,
      ok: false,
      refresh: refresh ?? "default",
      source,
    });
    return toWorkbenchApiError(error, "Cloudflare chat session request failed");
  }
}
