import { NextResponse } from "next/server";

import {
  getLatestCloudflareOwnedDemoRunSnapshot,
  startCloudflareOwnedDemoRun,
} from "@/lib/workbench/cloudflare-control-plane-client";

export const runtime = "nodejs";

const toErrorResponse = (error: unknown) =>
  NextResponse.json(
    { error: error instanceof Error ? error.message : "Cloudflare demo request failed" },
    { status: 502 },
  );

export async function GET() {
  try {
    return NextResponse.json(await getLatestCloudflareOwnedDemoRunSnapshot());
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST() {
  try {
    return NextResponse.json(await startCloudflareOwnedDemoRun(), { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
