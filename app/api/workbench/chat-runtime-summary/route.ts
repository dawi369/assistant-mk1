import { getChatRuntimeSummary } from "@/lib/workbench/cloudflare-control-plane-client";
import { workbenchJson } from "@/lib/workbench/route-handler";

export const runtime = "nodejs";

export async function GET() {
  return workbenchJson(getChatRuntimeSummary, "Cloudflare chat runtime summary request failed");
}
