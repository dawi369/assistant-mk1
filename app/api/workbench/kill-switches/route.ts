import { type NextRequest } from "next/server";

import {
  getCloudflareKillSwitches,
  updateCloudflareKillSwitch,
} from "@/lib/workbench/cloudflare-control-plane-client";
import { workbenchJson } from "@/lib/workbench/route-handler";

export const runtime = "nodejs";

export async function GET() {
  return workbenchJson(() => getCloudflareKillSwitches(), "Cloudflare kill-switch request failed");
}

export async function PUT(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return workbenchJson(
    () =>
      updateCloudflareKillSwitch({
        scopeKind: String(body.scopeKind) as "workspace" | "pack" | "tool" | "connection",
        scopeId: typeof body.scopeId === "string" ? body.scopeId : "",
        enabled: body.enabled === true,
        reason: typeof body.reason === "string" ? body.reason : "",
      }),
    "Cloudflare kill-switch update failed",
  );
}
