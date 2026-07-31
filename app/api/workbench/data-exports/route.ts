import { createCloudflareWorkspaceDataExport } from "@/lib/workbench/cloudflare-control-plane-client";
import { workbenchJson } from "@/lib/workbench/route-handler";

export const runtime = "nodejs";

export async function POST() {
  return workbenchJson(
    () => createCloudflareWorkspaceDataExport(),
    "Cloudflare workspace data export creation failed",
    { status: 202 },
  );
}
