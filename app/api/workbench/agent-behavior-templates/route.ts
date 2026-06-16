import { getCloudflareAgentBehaviorTemplates } from "@/lib/workbench/cloudflare-control-plane-client";
import { workbenchJson } from "@/lib/workbench/route-handler";

export const runtime = "nodejs";

export async function GET() {
  return workbenchJson(
    getCloudflareAgentBehaviorTemplates,
    "Cloudflare agent behavior templates request failed",
  );
}
