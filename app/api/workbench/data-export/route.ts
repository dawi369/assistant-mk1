import { toWorkbenchApiError } from "@/lib/workbench/api-errors";
import { getCloudflareWorkspaceDataExportResponse } from "@/lib/workbench/cloudflare-control-plane-client";

export const runtime = "nodejs";

export async function GET() {
  try {
    const response = await getCloudflareWorkspaceDataExportResponse();
    return new Response(response.body, {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") ?? "application/json",
        "content-disposition": response.headers.get("content-disposition") ?? "attachment",
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return toWorkbenchApiError(error, "Cloudflare workspace data export failed");
  }
}
