import { NextResponse } from "next/server";

import { toWorkbenchApiError } from "@/lib/workbench/api-errors";
import { streamChatSessionEvents } from "@/lib/workbench/cloudflare-control-plane-client";

export const runtime = "nodejs";

export async function GET() {
  try {
    const response = await streamChatSessionEvents();
    const headers = new Headers(response.headers);
    headers.delete("content-encoding");
    headers.delete("content-length");
    headers.delete("transfer-encoding");
    headers.set("cache-control", "no-store");
    headers.set("content-type", "text/event-stream; charset=utf-8");

    return new NextResponse(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (error) {
    return toWorkbenchApiError(error, "Cloudflare chat session stream failed");
  }
}
