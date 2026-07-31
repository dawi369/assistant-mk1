import { type NextRequest } from "next/server";

import { toWorkbenchApiError } from "@/lib/workbench/api-errors";
import { getCloudflareWorkspaceDataExportDownload } from "@/lib/workbench/cloudflare-control-plane-client";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  try {
    const response = await getCloudflareWorkspaceDataExportDownload(jobId);
    return new Response(response.body, { status: response.status, headers: response.headers });
  } catch (error) {
    return toWorkbenchApiError(error, "Cloudflare workspace data export download failed");
  }
}
