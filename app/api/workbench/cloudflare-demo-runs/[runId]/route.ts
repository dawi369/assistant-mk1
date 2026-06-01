import { NextResponse, type NextRequest } from "next/server";

import { getCloudflareOwnedDemoRunSnapshot } from "@/lib/workbench/cloudflare-control-plane-client";

export const runtime = "nodejs";

type Params = {
  runId: string;
};

export async function GET(_request: NextRequest, { params }: { params: Promise<Params> }) {
  const { runId } = await params;
  try {
    return NextResponse.json(await getCloudflareOwnedDemoRunSnapshot(runId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Cloudflare demo request failed" },
      { status: 502 },
    );
  }
}
