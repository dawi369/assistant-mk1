import { NextResponse, type NextRequest } from "next/server";

import { streamControlPlaneEvents } from "@/lib/workbench/cloudflare-control-plane-client";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const response = await streamControlPlaneEvents(request.nextUrl.searchParams.get("after"));
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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Cloudflare event stream failed" },
      { status: 502 },
    );
  }
}
