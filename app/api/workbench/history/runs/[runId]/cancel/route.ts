import { type NextRequest } from "next/server";

import { cancelCloudflareExecutionRun } from "@/lib/workbench/cloudflare-control-plane-client";
import { workbenchJson } from "@/lib/workbench/route-handler";

export const runtime = "nodejs";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  return workbenchJson(
    () => cancelCloudflareExecutionRun(runId),
    "Cloudflare run cancellation failed",
  );
}
