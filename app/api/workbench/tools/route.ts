import { getCloudflareTools } from "@/lib/workbench/cloudflare-control-plane-client";
import { workbenchJson } from "@/lib/workbench/route-handler";

export const runtime = "nodejs";

export async function GET() {
  return workbenchJson(getCloudflareTools, "Cloudflare tools request failed");
}
