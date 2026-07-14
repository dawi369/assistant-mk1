import { toWorkbenchApiError } from "@/lib/workbench/api-errors";
import { getCloudflareArtifactContentResponse } from "@/lib/workbench/cloudflare-control-plane-client";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ artifactId: string }> }) {
  try {
    const { artifactId } = await context.params;
    const response = await getCloudflareArtifactContentResponse(artifactId);
    return new Response(response.body, {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") ?? "application/octet-stream",
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return toWorkbenchApiError(error, "Cloudflare artifact content read failed");
  }
}
