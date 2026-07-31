import { type NextRequest, NextResponse } from "next/server";

import { completeCloudflareConnectionAuthorization } from "@/lib/workbench/cloudflare-control-plane-client";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const state = request.nextUrl.searchParams.get("state") ?? "";
  const code = request.nextUrl.searchParams.get("code") ?? "";
  try {
    await completeCloudflareConnectionAuthorization(state, code);
    return NextResponse.redirect(new URL("/?connection=authorized", request.nextUrl.origin));
  } catch {
    return NextResponse.redirect(new URL("/?connection=failed", request.nextUrl.origin));
  }
}
