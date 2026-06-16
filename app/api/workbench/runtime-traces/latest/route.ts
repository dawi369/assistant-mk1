import { getLatestRuntimeTraces } from "@/lib/workbench/cloudflare-control-plane-client";
import { workbenchJson } from "@/lib/workbench/route-handler";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? 10);
  return workbenchJson(
    () => getLatestRuntimeTraces(limit),
    "Cloudflare runtime traces request failed",
  );
}
