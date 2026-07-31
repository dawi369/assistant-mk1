import { type NextRequest } from "next/server";

import { getCloudflareActions } from "@/lib/workbench/cloudflare-control-plane-client";
import { workbenchJson } from "@/lib/workbench/route-handler";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? 25);
  return workbenchJson(
    () => getCloudflareActions(Number.isFinite(limit) ? limit : 25),
    "Cloudflare action proposals request failed",
  );
}
