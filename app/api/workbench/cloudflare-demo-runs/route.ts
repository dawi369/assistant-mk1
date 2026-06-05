import { NextResponse } from "next/server";

import {
  getLatestCloudflareOwnedDemoRunSnapshot,
  startCloudflareOwnedDemoRun,
} from "@/lib/workbench/cloudflare-control-plane-client";
import { toWorkbenchApiError } from "@/lib/workbench/api-errors";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await getLatestCloudflareOwnedDemoRunSnapshot());
  } catch (error) {
    return toWorkbenchApiError(error, "Cloudflare demo request failed");
  }
}

export async function POST() {
  try {
    return NextResponse.json(await startCloudflareOwnedDemoRun(), { status: 201 });
  } catch (error) {
    return toWorkbenchApiError(error, "Cloudflare demo request failed");
  }
}
