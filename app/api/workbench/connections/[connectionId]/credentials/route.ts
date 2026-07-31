import { type NextRequest } from "next/server";

import { storeCloudflareConnectionCredential } from "@/lib/workbench/cloudflare-control-plane-client";
import { workbenchJson } from "@/lib/workbench/route-handler";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  const { connectionId } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return workbenchJson(
    () =>
      storeCloudflareConnectionCredential(
        connectionId,
        typeof body.secret === "string" ? body.secret : "",
      ),
    "Cloudflare connection authorization failed",
  );
}
