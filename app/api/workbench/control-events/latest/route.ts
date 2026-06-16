import { getLatestControlPlaneEvents } from "@/lib/workbench/cloudflare-control-plane-client";
import { workbenchJson } from "@/lib/workbench/route-handler";

export const runtime = "nodejs";

export async function GET() {
  return workbenchJson(() => getLatestControlPlaneEvents(25), "Cloudflare event request failed");
}
