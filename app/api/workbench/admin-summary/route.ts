import { NextResponse } from "next/server";

import {
  isAdminSummaryProjection,
  type AdminSummaryProjection,
} from "@/lib/workbench/admin-summary-projection";
import { getCloudflareAdminSummary } from "@/lib/workbench/cloudflare-control-plane-client";
import { workbenchJson } from "@/lib/workbench/route-handler";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestedProjection = new URL(request.url).searchParams.get("projection")?.trim();
  let projection: AdminSummaryProjection | undefined;
  if (requestedProjection) {
    if (!isAdminSummaryProjection(requestedProjection)) {
      return NextResponse.json(
        { ok: false, error: "Unsupported admin summary projection" },
        { status: 400 },
      );
    }
    projection = requestedProjection;
  }

  return workbenchJson(
    () => getCloudflareAdminSummary({ projection }),
    "Cloudflare admin summary request failed",
  );
}
