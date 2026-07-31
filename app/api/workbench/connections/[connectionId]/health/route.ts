import { type NextRequest } from "next/server";

import { checkCloudflareConnectionHealth } from "@/lib/workbench/cloudflare-control-plane-client";
import { workbenchJson } from "@/lib/workbench/route-handler";

export const runtime = "nodejs";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  const { connectionId } = await params;
  return workbenchJson(
    () => checkCloudflareConnectionHealth(connectionId),
    "Cloudflare connection health check failed",
  );
}
