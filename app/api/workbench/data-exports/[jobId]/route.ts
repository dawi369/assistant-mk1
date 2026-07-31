import { type NextRequest } from "next/server";

import { getCloudflareWorkspaceDataJob } from "@/lib/workbench/cloudflare-control-plane-client";
import { workbenchJson } from "@/lib/workbench/route-handler";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  return workbenchJson(
    () => getCloudflareWorkspaceDataJob(jobId),
    "Cloudflare workspace data export read failed",
  );
}
