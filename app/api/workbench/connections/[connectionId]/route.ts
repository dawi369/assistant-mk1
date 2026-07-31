import { type NextRequest } from "next/server";

import { revokeCloudflareConnection } from "@/lib/workbench/cloudflare-control-plane-client";
import { workbenchJson } from "@/lib/workbench/route-handler";

export const runtime = "nodejs";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  const { connectionId } = await params;
  return workbenchJson(
    () => revokeCloudflareConnection(connectionId),
    "Cloudflare connection revocation failed",
  );
}
