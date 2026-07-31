import { getCloudflareConnections } from "@/lib/workbench/cloudflare-control-plane-client";
import { workbenchJson } from "@/lib/workbench/route-handler";

export const runtime = "nodejs";

export async function GET() {
  return workbenchJson(() => getCloudflareConnections(), "Cloudflare connections request failed");
}
