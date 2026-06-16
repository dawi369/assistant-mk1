import { getCloudflareAdminSummary } from "@/lib/workbench/cloudflare-control-plane-client";
import { workbenchJson } from "@/lib/workbench/route-handler";

export const runtime = "nodejs";

export async function GET() {
  return workbenchJson(getCloudflareAdminSummary, "Cloudflare admin summary request failed");
}
