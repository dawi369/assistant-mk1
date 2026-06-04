import { NextResponse } from "next/server";

import { getLatestControlPlaneEvents } from "@/lib/workbench/cloudflare-control-plane-client";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await getLatestControlPlaneEvents(25));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Cloudflare event request failed" },
      { status: 502 },
    );
  }
}
