import { type NextRequest } from "next/server";

import { requestCloudflareActionExecution } from "@/lib/workbench/cloudflare-control-plane-client";
import { workbenchJson } from "@/lib/workbench/route-handler";

export const runtime = "nodejs";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ proposalId: string }> },
) {
  const { proposalId } = await params;
  return workbenchJson(
    () => requestCloudflareActionExecution(proposalId),
    "Cloudflare action execution request failed",
    { status: 202 },
  );
}
