import { NextResponse, type NextRequest } from "next/server";

import { toWorkbenchApiError } from "@/lib/workbench/api-errors";
import { getCloudflareToolApprovals } from "@/lib/workbench/cloudflare-control-plane-client";

export const runtime = "nodejs";

const approvalStatuses = new Set(["requested", "decided", "all"]);

export async function GET(request: NextRequest) {
  try {
    const status = request.nextUrl.searchParams.get("status") ?? undefined;
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? "20");
    return NextResponse.json(
      await getCloudflareToolApprovals({
        status:
          status && approvalStatuses.has(status)
            ? (status as "requested" | "decided" | "all")
            : undefined,
        limit: Number.isFinite(limit) ? limit : undefined,
      }),
    );
  } catch (error) {
    return toWorkbenchApiError(error, "Cloudflare tool approvals request failed");
  }
}
