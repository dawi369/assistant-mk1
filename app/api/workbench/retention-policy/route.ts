import { NextResponse, type NextRequest } from "next/server";

import { toWorkbenchApiError } from "@/lib/workbench/api-errors";
import {
  getCloudflareRetentionPolicy,
  updateCloudflareRetentionPolicy,
} from "@/lib/workbench/cloudflare-control-plane-client";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await getCloudflareRetentionPolicy());
  } catch (error) {
    return toWorkbenchApiError(error, "Cloudflare retention policy read failed");
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json(
      await updateCloudflareRetentionPolicy({
        artifactRetentionDays: Number(body.artifactRetentionDays),
        operationalEventRetentionDays: Number(body.operationalEventRetentionDays),
        runtimeTraceRetentionDays: Number(body.runtimeTraceRetentionDays),
      }),
    );
  } catch (error) {
    return toWorkbenchApiError(error, "Cloudflare retention policy update failed");
  }
}
