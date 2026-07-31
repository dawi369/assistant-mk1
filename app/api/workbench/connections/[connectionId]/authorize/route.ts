import { type NextRequest } from "next/server";

import { startCloudflareConnectionAuthorization } from "@/lib/workbench/cloudflare-control-plane-client";
import { workbenchJson } from "@/lib/workbench/route-handler";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  const { connectionId } = await params;
  const redirectUri = new URL("/api/workbench/connections/oauth/callback", request.nextUrl.origin);
  return workbenchJson(
    () => startCloudflareConnectionAuthorization(connectionId, redirectUri.toString()),
    "Cloudflare OAuth authorization failed",
  );
}
