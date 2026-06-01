import { NextResponse } from "next/server";

import { getLatestCloudflareOwnedDemoRunSnapshot } from "@/lib/workbench/cloudflare-control-plane-client";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await getLatestCloudflareOwnedDemoRunSnapshot());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Cloudflare demo request failed" },
      { status: 502 },
    );
  }
}
